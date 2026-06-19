"""AKAROUTER Chat Completions — OpenAI-compatible proxy with model mapping and streaming support."""
from __future__ import annotations

import time
import logging
import json
from datetime import datetime, timezone, timedelta
from typing import Any, List, Optional, Union

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field, ConfigDict

from app.core.config import settings
from app.core.router import select_provider, release_provider, select_endpoint, release_endpoint, log_request
from app.core.rate_limit_middleware import enforce_tier_rate_limit, rate_limit_429
from app.core.supabase import get_supabase
from app.core.http_client import get_http_client
from app.core.cache import is_model_active, get_model_metadata

logger = logging.getLogger(__name__)
router = APIRouter()

# Decrypt provider endpoint API keys (Fernet)
def _decrypt_api_key(encrypted: str) -> str:
    from cryptography.fernet import Fernet
    key = settings.agent_key_encryption_secret.encode()
    return Fernet(key).decrypt(encrypted.encode()).decode()

def _build_endpoint_headers(api_key_encrypted: str) -> dict:
    return {
        "Authorization": f"Bearer {_decrypt_api_key(api_key_encrypted)}",
        "Content-Type": "application/json",
    }

# SECURITY: maximum body size for /v1/chat/completions. The previous code used
# req.json() with no size cap, allowing an attacker to POST a 100MB body and
# blow memory + cost. 1 MB is generous for legitimate completions; OpenAI itself
# caps at 2 MB for non-image, 50 MB for image inputs.
MAX_CHAT_REQUEST_BYTES = 1 * 1024 * 1024  # 1 MB


# ---------------------------------------------------------------------------
# Request validation models
# ---------------------------------------------------------------------------
# SECURITY: replace the previous dict-of-anything input with a strict Pydantic
# model. This rejects garbage (wrong types, missing fields, oversized arrays)
# at the edge with a 422 instead of forwarding it to the upstream API.

class ChatMessagePart(BaseModel):
    """A single content part (for multi-modal messages). Text-only enforced."""
    model_config = ConfigDict(extra="forbid")
    type: str = Field(..., pattern=r"^text$")  # only text parts accepted
    text: str = Field(..., max_length=128_000)


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: str = Field(..., pattern=r"^(system|user|assistant|tool|function)$")
    content: Union[str, List[ChatMessagePart]] = Field(...)
    name: Optional[str] = Field(None, max_length=256)

    @property
    def content_length(self) -> int:
        if isinstance(self.content, str):
            return len(self.content)
        return sum(len(p.text) for p in self.content)


class ChatCompletionRequest(BaseModel):
    """Strict request validation. extra='forbid' rejects unknown fields."""
    model_config = ConfigDict(extra="forbid")
    model: str = Field(..., min_length=1, max_length=128)
    messages: List[ChatMessage] = Field(..., min_length=1, max_length=200)
    stream: Optional[bool] = False
    temperature: Optional[float] = Field(None, ge=0.0, le=2.0)
    top_p: Optional[float] = Field(None, ge=0.0, le=1.0)
    max_tokens: Optional[int] = Field(None, ge=1, le=32_000)
    stop: Optional[Union[str, List[str]]] = None
    presence_penalty: Optional[float] = Field(None, ge=-2.0, le=2.0)
    frequency_penalty: Optional[float] = Field(None, ge=-2.0, le=2.0)
    n: Optional[int] = Field(None, ge=1, le=8)
    user: Optional[str] = Field(None, max_length=256)
    # stream_options, tools, response_format etc. can be added later; for now
    # we reject them with extra='forbid' to avoid surprises.

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


# ============ POINT SYSTEM ENFORCEMENT ============
# Per-account point balance (monthly_points_remaining). Decremented on every call.
# Free-model daily cap (daily_free_requests_remaining) only applies to 1pt models.
# Atomic via Postgres charge_account_points() / refund_account_points() functions.

def _is_free_model(points_cost: int) -> bool:
    """1pt models are 'free models' — daily-capped so freeloaders can't drain the budget."""
    return points_cost <= 1


async def _enforce_and_reserve_points(account_id: str, model_alias: str, points_cost: int) -> dict:
    """Atomically check + charge points for one call.

    Raises HTTPException if blocked. Returns reservation info (used for refund on failure).
    """
    from fastapi import HTTPException

    if points_cost < 0:
        raise HTTPException(status_code=500, detail=f"Invalid points_cost for model {model_alias}")

    supabase = get_supabase()
    is_free = _is_free_model(points_cost)

    result = supabase.rpc("charge_account_points", {
        "account_uuid": account_id,
        "points_to_charge": points_cost,
        "charge_free": is_free,
    }).execute()

    data = result.data if result else {}
    if isinstance(data, list):
        data = data[0] if data else {}

    if not data.get("ok"):
        reason = data.get("reason", "unknown")
        if reason == "daily_free_cap":
            reset_at = data.get("daily_free_reset_at", "in 24h")
            raise HTTPException(
                status_code=429,
                detail=f"Daily free-model limit reached ({data.get('daily_free_limit', 10)} req/day). Resets at {reset_at} or upgrade for unlimited free models.",
                headers={"Retry-After": "86400", "X-Free-Daily-Limit": str(data.get("daily_free_limit", 10))},
            )
        if reason == "insufficient_points":
            need = data.get("need", points_cost)
            have = data.get("have", 0)
            reset = data.get("points_reset_at", "")
            raise HTTPException(
                status_code=402,
                detail=f"Insufficient points: need {need}, have {have}. Resets {reset} or upgrade your plan.",
                headers={"X-Points-Need": str(need), "X-Points-Have": str(have)},
            )
        if reason == "account_not_found":
            raise HTTPException(status_code=404, detail="Account not found")
        if reason == "plan_not_found":
            raise HTTPException(status_code=500, detail="Plan configuration missing for tier")
        raise HTTPException(status_code=500, detail=f"Point charge failed: {reason}")

    return {
        "points_charged": int(data.get("points_charged", points_cost)),
        "remaining_after": int(data.get("monthly_remaining", 0)),
        "free_request_charged": bool(data.get("free_request_charged", False)),
        "free_remaining_after": int(data.get("daily_free_remaining", 0)),
    }


def _refund_points(account_id: str, reservation: dict) -> None:
    """Best-effort refund if the upstream call failed. Adds points back to the account."""
    if not reservation:
        return
    try:
        supabase = get_supabase()
        supabase.rpc("refund_account_points", {
            "account_uuid": account_id,
            "points_to_refund": reservation.get("points_charged", 0),
            "refund_free": reservation.get("free_request_charged", False),
        }).execute()
    except Exception as exc:
        logger.warning(f"Point refund failed for account {account_id}: {exc}")


def sanitize_error_msg(msg: str) -> str:
    """
    Map any upstream error string to a strict, opaque, user-safe category label.

    SECURITY: the previous implementation used string-replace on substrings
    (e.g. 'nous_api_base', 'inference-api.nousresearch.com', 'nousresearch').
    That fails closed for: (a) custom error messages that don't contain those
    substrings, leaking full upstream text to the user; (b) exception types and
    traceback fragments; (c) custom provider names. The cleaned string was also
    stored in request_logs and visible via the analytics endpoint.

    This new version maps ALL upstream errors to a fixed enum. The upstream
    error is logged with an opaque ID for operators; the user sees only the
    category label. Internal hostnames, provider names, and library names can
    never reach the client.
    """
    if not msg:
        return "upstream_error"
    s = str(msg).lower()
    if "rate limit" in s or "429" in s or "too many requests" in s:
        return "rate_limited"
    if "unauthorized" in s or "401" in s or "invalid api key" in s or "invalid_api_key" in s:
        return "auth_failed"
    if "forbidden" in s or "403" in s or "permission" in s:
        return "forbidden"
    if "billing" in s or "quota" in s or "insufficient" in s or "402" in s:
        return "billing"
    if "timeout" in s or "timed out" in s or "504" in s or "deadline" in s:
        return "timeout"
    if "connect" in s and ("refused" in s or "reset" in s or "error" in s):
        return "connection_failed"
    if any(code in s for code in ("500", "502", "503", "internal server", "bad gateway", "service unavailable")):
        return "upstream_unavailable"
    if "invalid request" in s or "400" in s or "validation" in s or "bad request" in s:
        return "invalid_request"
    if "model" in s and ("not found" in s or "unknown" in s or "unsupported" in s):
        return "model_unavailable"
    return "upstream_error"


@router.post("/v1/chat/completions")
async def proxy_chat(req: Request):
    # SECURITY: enforce a hard body-size cap BEFORE reading the body. The
    # previous code used `req.json()` with no size limit, allowing a 100MB POST
    # to blow memory and cost. Reject with 413 early.
    content_length = req.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_CHAT_REQUEST_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"Request body too large. Max {MAX_CHAT_REQUEST_BYTES // 1024} KB."
                )
        except ValueError:
            pass

    # Read body once with a hard cap. Anything past the cap raises.
    raw_body = b""
    async for chunk in req.stream():
        raw_body += chunk
        if len(raw_body) > MAX_CHAT_REQUEST_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Request body too large. Max {MAX_CHAT_REQUEST_BYTES // 1024} KB."
            )

    try:
        raw = json.loads(raw_body.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    # SECURITY: strict Pydantic validation. Rejects unknown fields, wrong
    # types, oversized messages, etc. with a 422.
    try:
        body = ChatCompletionRequest.model_validate(raw)
    except Exception as ve:
        # Surface only a generic message; full Pydantic details go to logs (already
        # printed by Pydantic). Don't echo internal model fields back to clients.
        raise HTTPException(status_code=422, detail="Invalid request body")

    model_alias = body.model
    if model_alias not in settings.model_mapping:
        raise HTTPException(status_code=400, detail=f"Unknown model '{model_alias}'")

    if not is_model_active(model_alias):
        raise HTTPException(status_code=400, detail=f"Model '{model_alias}' is disabled by administrator")

    # Re-serialize the validated body to a dict for downstream use. `body.model_dump(exclude_none=True)`
    # strips None values, matching OpenAI's wire format.
    body_dict = body.model_dump(exclude_none=True)
    upstream_model = settings.resolve_model(model_alias)
    body_dict["model"] = upstream_model

    # Re-validate total prompt length (defense in depth: per-message caps above
    # already prevent this, but we double-check total).
    total_chars = sum(m.content_length for m in body.messages)
    if total_chars > 1_000_000:  # ~250k tokens worst case
        raise HTTPException(status_code=413, detail="Total prompt content too large")

    # Pick routing target: per-request endpoint vs OAuth provider pool
    meta = get_model_metadata(model_alias)
    pricing_mode = meta.get("pricing_mode") or "per_token"

    # Charge points for this call (atomic via Postgres function). Raises 402/429 if blocked.
    # We deduct BEFORE the upstream call to prevent abuse, then refund on failure.
    points_cost = int(meta.get("points_cost", 5))
    auth_info_early = getattr(req.state, "auth", None)
    account_id_early = auth_info_early["account_id"] if auth_info_early else None
    point_reservation = None
    if account_id_early:
        point_reservation = await _enforce_and_reserve_points(account_id_early, model_alias, points_cost)

    use_endpoint = False
    endpoint = None
    if pricing_mode == "per_request":
        endpoint = await select_endpoint(model_alias)
        if not endpoint:
            logger.warning(f"No endpoint for per_request model {model_alias}; falling back to OAuth")
        else:
            use_endpoint = True

    if use_endpoint:
        provider = {
            "id": endpoint["endpoint_id"],
            "name": endpoint["name"],
            "url": endpoint["url"],
            "api_key_encrypted": endpoint["api_key_encrypted"],
            "rate_limit_req_min": endpoint.get("rate_limit_req_min"),
        }
    else:
        provider = await select_provider(upstream_model)
        if not provider:
            raise HTTPException(status_code=400, detail=f"No provider available for model '{model_alias}'")

    # Build upstream URL and auth
    if use_endpoint:
        upstream_url = f"{endpoint['url'].rstrip('/')}/chat/completions"
        upstream_headers = _build_endpoint_headers(endpoint["api_key_encrypted"])
        provider_id = endpoint["endpoint_id"]
        release_fn = lambda ok, err=None: release_endpoint(endpoint["endpoint_id"])
    else:
        upstream_url = f"{settings.nous_api_base}/chat/completions"
        upstream_headers = {
            "Authorization": f"Bearer {provider['access_token']}",
            "Content-Type": "application/json",
        }
        provider_id = provider["id"]
        release_fn = lambda ok, err=None: release_provider(provider["id"], ok, err)

    # Get auth info from middleware
    auth_info = getattr(req.state, "auth", None)
    account_id = auth_info["account_id"] if auth_info else None
    api_key_id = auth_info.get("key_id") if auth_info else None

    # SECURITY: per-API-key rate limit. The previous code only enforced
    # the token-budget limit (a separate concern: dollars/usage, not
    # request count). An attacker with a stolen key could fire 10000
    # tiny requests/min and rack up real cost. Capping request count
    # separately makes burst abuse visible. Limits are per-tier: free
    # = 20/min, starter = 60/min, pro = 120/min, ultra = 300/min.
    if auth_info and api_key_id and account_id:
        # Use tier if the auth info carries it; fall back to "free"
        # so an unprovisioned key still gets the strictest limit.
        tier = auth_info.get("tier") or "free"
        rl = await enforce_tier_rate_limit(
            req,
            scope=f"chat.api_key:{api_key_id}",
            identifier=api_key_id,
            tier=tier,
        )
        if not rl.allowed:
            raise rate_limit_429(rl)

    stream = body_dict.get("stream", False)
    if stream:
        # Request upstream provider to include usage chunk at the end of the stream
        body_dict["stream_options"] = {"include_usage": True}

    if stream:
        started = time.time()
        client = get_http_client()
        try:
            req_obj = client.build_request(
                "POST",
                upstream_url,
                headers=upstream_headers,
                json=body_dict,
            )
            response = await client.send(req_obj, stream=True)
            
            if response.status_code >= 400:
                await response.aread()
                await response.aclose()
                
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
                await release_fn(False, f"Streaming status error: {cleaned_msg}")
                await log_request(
                    account_id=account_id, api_key_id=api_key_id, provider_id=provider_id,
                    model=model_alias, upstream_model=upstream_model,
                    status_code=response.status_code, latency_ms=latency, error_message=f"StreamStatusError: {cleaned_msg}"
                )
                _refund_points(account_id, point_reservation)
                raise HTTPException(
                    status_code=response.status_code, 
                    detail=f"Upstream provider error: {cleaned_msg}"
                )
        except HTTPException:
            raise
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            latency = int((time.time() - started) * 1000)
            await release_fn(False, "Connection failed to upstream")
            await log_request(
                account_id=account_id, api_key_id=api_key_id, provider_id=provider_id,
                model=model_alias, upstream_model=upstream_model,
                status_code=502, latency_ms=latency, error_message="ConnectError (Stream)"
            )
            _refund_points(account_id, point_reservation)
            raise HTTPException(status_code=502, detail="Upstream gateway timeout or connection failure")
        except httpx.RequestError as exc:
            latency = int((time.time() - started) * 1000)
            await release_fn(False, str(exc))
            await log_request(
                account_id=account_id, api_key_id=api_key_id, provider_id=provider_id,
                model=model_alias, upstream_model=upstream_model,
                status_code=502, latency_ms=latency, error_message=f"RequestError (Stream): {exc}"
            )
            _refund_points(account_id, point_reservation)
            raise HTTPException(status_code=502, detail="Upstream request failed")
        except Exception as exc:
            latency = int((time.time() - started) * 1000)
            await release_fn(False, str(exc))
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
                raise
            finally:
                await response.aclose()
                latency = int((time.time() - started) * 1000)
                await release_fn(success)
                
                # Determine tokens
                if extractor.has_usage and extractor.prompt_tokens > 0:
                    prompt_tokens = extractor.prompt_tokens
                    completion_tokens = extractor.completion_tokens
                else:
                    prompt_tokens = estimate_prompt_tokens(body_dict.get("messages", []))
                    completion_tokens = max(1, len(extractor.completion_text) // 4)
                
                total_tokens = prompt_tokens + completion_tokens

                # If the stream failed mid-flight, refund the points
                if not success and point_reservation:
                    _refund_points(account_id, point_reservation)

                await log_request(
                    account_id=account_id, api_key_id=api_key_id, provider_id=provider_id,
                    model=model_alias, upstream_model=upstream_model,
                    status_code=200 if success else 502, latency_ms=latency,
                    prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
                    total_tokens=total_tokens
                )

        # Surface point usage on the streaming response headers so client can update balance UI
        stream_headers = {
            "X-Points-Remaining": str(point_reservation.get("remaining_after", 0)) if point_reservation else "",
            "X-Points-Charged": str(point_reservation.get("points_charged", 0)) if point_reservation else "",
            "X-Free-Remaining": str(point_reservation.get("free_remaining_after", 0)) if point_reservation else "",
        }
        stream_headers = {k: v for k, v in stream_headers.items() if v}
        return StreamingResponse(stream_generator(), media_type="text/event-stream", headers=stream_headers)

    # Non-streaming request
    started = time.time()
    try:
        endpoint_base = upstream_url.rsplit('/chat/completions', 1)[0] if use_endpoint else None
        response = await _upstream(provider, body_dict, base_url=endpoint_base)
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
        await release_fn(False, f"HTTP status error: {cleaned_msg}")
        await log_request(
            account_id=account_id, api_key_id=api_key_id, provider_id=provider_id,
            model=model_alias, upstream_model=upstream_model,
            status_code=exc.response.status_code, latency_ms=latency, error_message=f"HTTPStatusError: {cleaned_msg}"
        )
        _refund_points(account_id, point_reservation)
        raise HTTPException(
            status_code=exc.response.status_code, 
            detail=f"Upstream provider error: {cleaned_msg}"
        )
    except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
        latency = int((time.time() - started) * 1000)
        await release_fn(False, "Connection failed to upstream")
        await log_request(
            account_id=account_id, api_key_id=api_key_id, provider_id=provider_id,
            model=model_alias, upstream_model=upstream_model,
            status_code=502, latency_ms=latency, error_message="ConnectError"
        )
        _refund_points(account_id, point_reservation)
        raise HTTPException(status_code=502, detail="Upstream gateway timeout or connection failure")
    except httpx.RequestError as exc:
        latency = int((time.time() - started) * 1000)
        await release_fn(False, str(exc))
        await log_request(
            account_id=account_id, api_key_id=api_key_id, provider_id=provider_id,
            model=model_alias, upstream_model=upstream_model,
            status_code=502, latency_ms=latency, error_message=f"RequestError: {exc}"
        )
        _refund_points(account_id, point_reservation)
        raise HTTPException(status_code=502, detail="Upstream request failed")
    except Exception as exc:
        latency = int((time.time() - started) * 1000)
        await release_fn(False, str(exc))
        await log_request(
            account_id=account_id, api_key_id=api_key_id, provider_id=provider_id,
            model=model_alias, upstream_model=upstream_model,
            status_code=500, latency_ms=latency, error_message=str(exc)
        )
        _refund_points(account_id, point_reservation)
        raise HTTPException(status_code=500, detail=f"Internal proxy error: {sanitize_error_msg(str(exc))}")

    latency = int((time.time() - started) * 1000)
    await release_fn(True)

    # Extract token usage from response
    usage = response.get("usage", {}) if response else {}
    prompt_tokens = usage.get("prompt_tokens", 0)
    completion_tokens = usage.get("completion_tokens", 0)
    total_tokens = usage.get("total_tokens", 0)

    await log_request(
        account_id=account_id, api_key_id=api_key_id, provider_id=provider_id,
        model=model_alias, upstream_model=upstream_model,
        status_code=200, latency_ms=latency,
        prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
        total_tokens=total_tokens
    )

    # Return response with user-facing model alias + point usage headers
    response.setdefault("id", f"chatcmpl-{id(provider):024d}")
    response["model"] = model_alias
    point_headers = {}
    if point_reservation:
        point_headers = {
            "X-Points-Remaining": str(point_reservation.get("remaining_after", 0)),
            "X-Points-Charged": str(point_reservation.get("points_charged", 0)),
            "X-Free-Remaining": str(point_reservation.get("free_remaining_after", 0)),
        }
    return JSONResponse(content=response, headers=point_headers)


async def _upstream(provider: dict, body: dict, base_url: str | None = None) -> dict:
    client = get_http_client()
    url = (base_url or settings.nous_api_base).rstrip('/') + '/chat/completions'
    auth_header = {}
    if base_url is None:
        auth_header = {"Authorization": f"Bearer {provider['access_token']}"}
    response = await client.post(
        url,
        headers={
            **auth_header,
            "Content-Type": "application/json",
        },
        json=body,
    )
    response.raise_for_status()
    try:
        return response.json()
    except Exception as exc:
        text_preview = response.text[:500] if response.text else "<empty response>"
        logger.error(f"Failed to parse JSON response from upstream {url}: {exc}. Response text: {text_preview}")
        raise ValueError(f"Upstream returned invalid JSON response: {text_preview}")


async def _try_refresh(provider: dict) -> bool:
    """Try to refresh a provider's access token atomically using CAS locking."""
    if not provider.get("refresh_token"):
        return False

    supabase = get_supabase()
    now_ts = datetime.now(timezone.utc)
    lock_threshold = now_ts - timedelta(seconds=settings.refresh_lock_ttl)
    
    # Try to acquire the refresh lock atomically in PostgreSQL
    try:
        lock_res = supabase.table("providers").update({
            "refresh_lock_acquired_at": now_ts.isoformat()
        }).eq("id", provider["id"]).or_(
            f"refresh_lock_acquired_at.is.null,refresh_lock_acquired_at.lt.{lock_threshold.isoformat()}"
        ).execute()
        
        if not lock_res.data:
            logger.info(f"Token refresh lock for provider {provider['id']} already held by another concurrent request. Skipping.")
            return False
    except Exception as e:
        logger.error(f"Failed to acquire token refresh lock for provider {provider['id']}: {e}")
        return False

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
        client = get_http_client()
        response = await client.post(settings.nous_token_url, data=payload, headers=headers, timeout=30.0)
        response.raise_for_status()
        token_resp = response.json()
    except Exception as exc:
        logger_msg = f"[refresh] failed provider={provider['id']} error={exc}"
        print(logger_msg)
        # Release the lock on failure so it can be retried immediately
        try:
            supabase.table("providers").update({
                "refresh_lock_acquired_at": None
            }).eq("id", provider["id"]).execute()
        except Exception:
            pass
        return False

    # Update provider in DB
    expires_in = int(token_resp.get("expires_in", 900))
    new_expires = time.strftime(
        "%Y-%m-%dT%H:%M:%SZ",
        time.gmtime(time.time() + expires_in - settings.token_refresh_skew),
    )
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
