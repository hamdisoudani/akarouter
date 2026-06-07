"""AKAROUTER Chat Completions — OpenAI-compatible proxy with model mapping."""
from __future__ import annotations

import time
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.router import select_provider, release_provider, log_request
from app.core.supabase import get_supabase

router = APIRouter()


class ChatRequest(BaseModel):
    model: str
    messages: list[dict[str, Any]] = Field(default_factory=list)
    stream: bool = False
    temperature: float | None = None
    max_tokens: int | None = None


@router.post("/v1/chat/completions")
async def proxy_chat(request: ChatRequest, req: Request) -> dict:
    # Resolve model alias → upstream model
    upstream_model = settings.resolve_model(request.model)

    # Pick provider
    provider = await select_provider(upstream_model)
    if not provider:
        raise HTTPException(status_code=400, detail=f"No provider available for model '{request.model}'")

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

    started = time.time()
    try:
        response = await _upstream(provider, upstream_model, request.messages, request.stream,
                                    temperature=request.temperature, max_tokens=request.max_tokens)
    except Exception as exc:
        latency = int((time.time() - started) * 1000)
        await release_provider(provider["id"], False, str(exc))
        await log_request(
            account_id=account_id, api_key_id=api_key_id, provider_id=provider["id"],
            model=request.model, upstream_model=upstream_model,
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
        model=request.model, upstream_model=upstream_model,
        status_code=200, latency_ms=latency,
        prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
        total_tokens=total_tokens
    )

    # Return response with user-facing model alias
    response.setdefault("id", f"chatcmpl-{id(provider):024d}")
    response["model"] = request.model
    return response


async def _upstream(provider: dict, model: str, messages: list[dict[str, Any]], stream: bool,
                     temperature: float | None = None, max_tokens: int | None = None) -> dict:
    body: dict[str, Any] = {"model": model, "messages": messages, "stream": stream}
    if temperature is not None:
        body["temperature"] = temperature
    if max_tokens is not None:
        body["max_tokens"] = max_tokens

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
        return response.json()


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

    return True
