"""AKAROUTER Chat Completions — OpenAI-compatible proxy with model mapping and streaming support."""
from __future__ import annotations

import time
import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.core.config import settings
from app.core.router import select_provider, release_provider, log_request
from app.core.supabase import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/v1/chat/completions")
async def proxy_chat(req: Request):
    try:
        body = await req.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    model_alias = body.get("model")
    if not model_alias:
        raise HTTPException(status_code=400, detail="Missing 'model' parameter")

    if model_alias not in settings.model_mapping:
        raise HTTPException(status_code=400, detail=f"Unknown model '{model_alias}'")

    from app.core.cache import is_model_active
    if not is_model_active(model_alias):
        raise HTTPException(status_code=400, detail=f"Model '{model_alias}' is disabled by administrator")

    # Resolve model alias → upstream model
    upstream_model = settings.resolve_model(model_alias)
    body["model"] = upstream_model

    # Pick provider
    provider = await select_provider(upstream_model)
    if not provider:
        raise HTTPException(status_code=400, detail=f"No provider available for model '{model_alias}'")

    # Check if token needs refresh
    if provider.get("token_expires_at"):
        try:
            from datetime import datetime
            exp = datetime.fromisoformat(provider["token_expires_at"].replace("Z", "+00:00"))
            if exp.timestamp() - time.time() < settings.token_refresh_skew:
                # Token expired, try refresh
                refreshed = await _try_refresh(provider)
                if not refreshed:
                    await release_provider(provider["id"], False, "Token expired and refresh failed")
                    raise HTTPException(status_code=502, detail="Token refresh failed")
        except (ValueError, TypeError):
            pass

    # Get auth info from middleware
    auth_info = getattr(req.state, "auth", None)
    account_id = auth_info["account_id"] if auth_info else None
    api_key_id = auth_info.get("key_id") if auth_info else None

    stream = body.get("stream", False)

    if stream:
        async def stream_generator():
            started = time.time()
            success = False
            try:
                async with httpx.AsyncClient(timeout=120) as client:
                    async with client.stream(
                        "POST",
                        f"{settings.nous_api_base}/chat/completions",
                        headers={
                            "Authorization": f"Bearer {provider['access_token']}",
                            "Content-Type": "application/json",
                        },
                        json=body,
                    ) as response:
                        response.raise_for_status()
                        async for chunk in response.aiter_bytes():
                            yield chunk
                success = True
            except Exception as exc:
                logger.error(f"Streaming request failed: {exc}")
                await release_provider(provider["id"], False, str(exc))
                # Re-raise so stream client gets disconnected
                raise
            finally:
                latency = int((time.time() - started) * 1000)
                await release_provider(provider["id"], success)
                # For streaming, we log request with 0 tokens (or simple estimate)
                await log_request(
                    account_id=account_id, api_key_id=api_key_id, provider_id=provider["id"],
                    model=model_alias, upstream_model=upstream_model,
                    status_code=200 if success else 502, latency_ms=latency,
                    prompt_tokens=0, completion_tokens=0, total_tokens=0
                )

        return StreamingResponse(stream_generator(), media_type="text/event-stream")

    # Non-streaming request
    started = time.time()
    try:
        response = await _upstream(provider, body)
    except Exception as exc:
        latency = int((time.time() - started) * 1000)
        await release_provider(provider["id"], False, str(exc))
        await log_request(
            account_id=account_id, api_key_id=api_key_id, provider_id=provider["id"],
            model=model_alias, upstream_model=upstream_model,
            status_code=502, latency_ms=latency, error_message=str(exc)
        )
        raise HTTPException(status_code=502, detail=f"Upstream error: {exc}")

    latency = int((time.time() - started) * 1000)
    await release_provider(provider["id"], True)

    # Extract token usage from response
    usage = response.get("usage", {}) if response else {}
    prompt_tokens = usage.get("prompt_tokens", 0)
    completion_tokens = usage.get("completion_tokens", 0)
    total_tokens = usage.get("total_tokens", 0)

    await log_request(
        account_id=account_id, api_key_id=api_key_id, provider_id=provider["id"],
        model=model_alias, upstream_model=upstream_model,
        status_code=200, latency_ms=latency,
        prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
        total_tokens=total_tokens
    )

    # Return response with user-facing model alias
    response.setdefault("id", f"chatcmpl-{id(provider):024d}")
    response["model"] = model_alias
    return response


async def _upstream(provider: dict, body: dict) -> dict:
    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(
            f"{settings.nous_api_base}/chat/completions",
            headers={
                "Authorization": f"Bearer {provider['access_token']}",
                "Content-Type": "application/json",
            },
            json=body,
        )
        response.raise_for_status()
        try:
            return response.json()
        except Exception as exc:
            text_preview = response.text[:500] if response.text else "<empty response>"
            logger.error(f"Failed to parse JSON response from upstream {settings.nous_api_base}: {exc}. Response text: {text_preview}")
            raise ValueError(f"Upstream returned invalid JSON response: {text_preview}")


async def _try_refresh(provider: dict) -> bool:
    """Try to refresh a provider's access token."""
    if not provider.get("refresh_token"):
        return False

    # Check refresh lock
    if provider.get("refresh_lock_acquired_at"):
        try:
            from datetime import datetime
            lock = datetime.fromisoformat(provider["refresh_lock_acquired_at"].replace("Z", "+00:00"))
            if (time.time() - lock.timestamp()) < settings.refresh_lock_ttl:
                return False
        except (ValueError, TypeError):
            pass

    payload = {
        "grant_type": "refresh_token",
        "refresh_token": provider["refresh_token"],
        "client_id": settings.nous_client_id,
    }
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-nous-refresh-token": provider["refresh_token"],
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(settings.nous_token_url, data=payload, headers=headers)
            response.raise_for_status()
            token_resp = response.json()
    except Exception as exc:
        logger_msg = f"[refresh] failed provider={provider['id']} error={exc}"
        print(logger_msg)
        return False

    # Update provider in DB
    expires_in = int(token_resp.get("expires_in", 900))
    new_expires = time.strftime(
        "%Y-%m-%dT%H:%M:%SZ",
        time.gmtime(time.time() + expires_in - settings.token_refresh_skew),
    )
    supabase = get_supabase()
    supabase.table("providers").update({
        "access_token": token_resp["access_token"],
        "refresh_token": token_resp.get("refresh_token", provider["refresh_token"]),
        "token_expires_at": new_expires,
        "refresh_lock_acquired_at": None,
    }).eq("id", provider["id"]).execute()

    # Update provider dict inline for the caller
    provider["access_token"] = token_resp["access_token"]
    if "refresh_token" in token_resp:
        provider["refresh_token"] = token_resp["refresh_token"]
    provider["token_expires_at"] = new_expires

    return True
