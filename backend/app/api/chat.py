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

import json

class SSEUsageExtractor:
    def __init__(self):
        self.buffer = ""
        self.completion_text = ""
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.has_usage = False

    def feed(self, chunk_bytes: bytes) -> None:
        self.buffer += chunk_bytes.decode("utf-8", errors="ignore")
        while "\n" in self.buffer:
            line, self.buffer = self.buffer.split("\n", 1)
            line = line.strip()
            if line.startswith("data:"):
                data_content = line[5:].strip()
                if data_content == "[DONE]":
                    continue
                try:
                    data_json = json.loads(data_content)
                    
                    # 1. Check if there is usage info in this chunk (OpenAI style)
                    usage = data_json.get("usage")
                    if usage:
                        self.prompt_tokens = usage.get("prompt_tokens", 0)
                        self.completion_tokens = usage.get("completion_tokens", 0)
                        self.has_usage = True
                        
                    # 2. Accumulate delta content for fallback estimation
                    choices = data_json.get("choices", [])
                    if choices:
                        delta = choices[0].get("delta", {})
                        content = delta.get("content", "")
                        if content:
                            self.completion_text += content
                except Exception:
                    pass


def estimate_prompt_tokens(messages: list) -> int:
    total_tokens = 0
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str):
            total_tokens += max(1, len(content) // 4)
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    total_tokens += max(1, len(part.get("text", "")) // 4)
        total_tokens += 4
    return total_tokens + 2


def sanitize_error_msg(msg: str) -> str:
    if not msg:
        return ""
    # Remove/replace references to raw upstream hostnames or provider names
    cleaned = msg.replace(settings.nous_api_base, "AkaRouter Gateway")
    cleaned = cleaned.replace("inference-api.nousresearch.com", "AkaRouter Gateway")
    cleaned = cleaned.replace("nousresearch", "upstream provider")
    return cleaned


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
        # Request upstream provider to include usage chunk at the end of the stream
        body["stream_options"] = {"include_usage": True}

    if stream:
        started = time.time()
        client = httpx.AsyncClient(timeout=120)
        try:
            req_obj = client.build_request(
                "POST",
                f"{settings.nous_api_base}/chat/completions",
                headers={
                    "Authorization": f"Bearer {provider['access_token']}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            response = await client.send(req_obj, stream=True)
            
            if response.status_code >= 400:
                await response.aread()
                await client.aclose()
                
                upstream_error = ""
                try:
                    err_json = response.json()
                    if isinstance(err_json, dict):
                        if "detail" in err_json:
                            upstream_error = str(err_json["detail"])
                        elif "error" in err_json and isinstance(err_json["error"], dict) and "message" in err_json["error"]:
                            upstream_error = str(err_json["error"]["message"])
                        else:
                            upstream_error = str(err_json)
                except Exception:
                    pass

                if not upstream_error:
                    upstream_error = f"Status {response.status_code}"

                cleaned_msg = sanitize_error_msg(upstream_error)
                latency = int((time.time() - started) * 1000)
                await release_provider(provider["id"], False, f"Streaming status error: {cleaned_msg}")
                await log_request(
                    account_id=account_id, api_key_id=api_key_id, provider_id=provider["id"],
                    model=model_alias, upstream_model=upstream_model,
                    status_code=response.status_code, latency_ms=latency, error_message=f"StreamStatusError: {cleaned_msg}"
                )
                raise HTTPException(
                    status_code=response.status_code, 
                    detail=f"Upstream provider error: {cleaned_msg}"
                )
        except HTTPException:
            raise
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            await client.aclose()
            latency = int((time.time() - started) * 1000)
            await release_provider(provider["id"], False, "Connection failed to upstream")
            await log_request(
                account_id=account_id, api_key_id=api_key_id, provider_id=provider["id"],
                model=model_alias, upstream_model=upstream_model,
                status_code=502, latency_ms=latency, error_message="ConnectError (Stream)"
            )
            raise HTTPException(status_code=502, detail="Upstream gateway timeout or connection failure")
        except httpx.RequestError as exc:
            await client.aclose()
            latency = int((time.time() - started) * 1000)
            await release_provider(provider["id"], False, str(exc))
            await log_request(
                account_id=account_id, api_key_id=api_key_id, provider_id=provider["id"],
                model=model_alias, upstream_model=upstream_model,
                status_code=502, latency_ms=latency, error_message=f"RequestError (Stream): {exc}"
            )
            raise HTTPException(status_code=502, detail="Upstream request failed")
        except Exception as exc:
            await client.aclose()
            latency = int((time.time() - started) * 1000)
            await release_provider(provider["id"], False, str(exc))
            raise HTTPException(status_code=500, detail=f"Internal proxy error: {sanitize_error_msg(str(exc))}")

        async def stream_generator():
            success = False
            extractor = SSEUsageExtractor()
            try:
                async for chunk in response.aiter_bytes():
                    extractor.feed(chunk)
                    yield chunk
                success = True
            except Exception as exc:
                logger.error(f"Streaming failed mid-stream: {exc}")
                await release_provider(provider["id"], False, str(exc))
                raise
            finally:
                await response.aclose()
                await client.aclose()
                latency = int((time.time() - started) * 1000)
                await release_provider(provider["id"], success)
                
                # Determine tokens
                if extractor.has_usage and extractor.prompt_tokens > 0:
                    prompt_tokens = extractor.prompt_tokens
                    completion_tokens = extractor.completion_tokens
                else:
                    prompt_tokens = estimate_prompt_tokens(body.get("messages", []))
                    completion_tokens = max(1, len(extractor.completion_text) // 4)
                
                total_tokens = prompt_tokens + completion_tokens
                
                await log_request(
                    account_id=account_id, api_key_id=api_key_id, provider_id=provider["id"],
                    model=model_alias, upstream_model=upstream_model,
                    status_code=200 if success else 502, latency_ms=latency,
                    prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
                    total_tokens=total_tokens
                )

        return StreamingResponse(stream_generator(), media_type="text/event-stream")

    # Non-streaming request
    started = time.time()
    try:
        response = await _upstream(provider, body)
    except httpx.HTTPStatusError as exc:
        latency = int((time.time() - started) * 1000)
        upstream_error = ""
        try:
            err_json = exc.response.json()
            if isinstance(err_json, dict):
                if "detail" in err_json:
                    upstream_error = str(err_json["detail"])
                elif "error" in err_json and isinstance(err_json["error"], dict) and "message" in err_json["error"]:
                    upstream_error = str(err_json["error"]["message"])
                else:
                    upstream_error = str(err_json)
        except Exception:
            pass

        if not upstream_error:
            upstream_error = f"Status {exc.response.status_code}"

        cleaned_msg = sanitize_error_msg(upstream_error)
        await release_provider(provider["id"], False, f"HTTP status error: {cleaned_msg}")
        await log_request(
            account_id=account_id, api_key_id=api_key_id, provider_id=provider["id"],
            model=model_alias, upstream_model=upstream_model,
            status_code=exc.response.status_code, latency_ms=latency, error_message=f"HTTPStatusError: {cleaned_msg}"
        )
        raise HTTPException(
            status_code=exc.response.status_code, 
            detail=f"Upstream provider error: {cleaned_msg}"
        )
    except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
        latency = int((time.time() - started) * 1000)
        await release_provider(provider["id"], False, "Connection failed to upstream")
        await log_request(
            account_id=account_id, api_key_id=api_key_id, provider_id=provider["id"],
            model=model_alias, upstream_model=upstream_model,
            status_code=502, latency_ms=latency, error_message="ConnectError"
        )
        raise HTTPException(status_code=502, detail="Upstream gateway timeout or connection failure")
    except httpx.RequestError as exc:
        latency = int((time.time() - started) * 1000)
        await release_provider(provider["id"], False, str(exc))
        await log_request(
            account_id=account_id, api_key_id=api_key_id, provider_id=provider["id"],
            model=model_alias, upstream_model=upstream_model,
            status_code=502, latency_ms=latency, error_message=f"RequestError: {exc}"
        )
        raise HTTPException(status_code=502, detail="Upstream request failed")
    except Exception as exc:
        latency = int((time.time() - started) * 1000)
        await release_provider(provider["id"], False, str(exc))
        await log_request(
            account_id=account_id, api_key_id=api_key_id, provider_id=provider["id"],
            model=model_alias, upstream_model=upstream_model,
            status_code=500, latency_ms=latency, error_message=str(exc)
        )
        raise HTTPException(status_code=500, detail=f"Internal proxy error: {sanitize_error_msg(str(exc))}")

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
