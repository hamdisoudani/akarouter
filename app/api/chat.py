"""Chat completions endpoint — OpenAI-compatible /v1/chat/completions."""
import time
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Request, Response, HTTPException, Header

from app.core.config import settings
from app.core.router import (
    authenticate_api_key,
    select_provider,
    release_provider,
    log_request,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def _extract_api_key(authorization: Optional[str]) -> Optional[str]:
    """Extract Bearer token from Authorization header."""
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return None


@router.post("/v1/chat/completions")
async def chat_completions(
    request: Request,
    authorization: Optional[str] = Header(None),
) -> Response:
    """OpenAI-compatible chat completions with AKAROUTER routing."""
    start = time.time()

    # Authenticate
    api_key = _extract_api_key(authorization)
    if not api_key:
        raise HTTPException(status_code=401, detail="Missing Authorization header. Use: Bearer akar_<your-key>")

    auth = await authenticate_api_key(api_key)
    if not auth:
        raise HTTPException(status_code=401, detail="Invalid or inactive API key")

    # Store auth for models endpoint
    request.state.auth = auth

    # Parse request body
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    model = body.get("model", settings.default_model)
    messages = body.get("messages", [])

    if not messages:
        raise HTTPException(status_code=400, detail="messages is required")

    # Check model access
    allowed = auth.get("allowed_models", ["*"])
    if "*" not in allowed and model not in allowed:
        raise HTTPException(status_code=403, detail=f"Model {model} not available on your tier")

    # Select provider
    provider = await select_provider(model)
    if not provider:
        raise HTTPException(status_code=503, detail="No available providers. Add accounts via /admin/providers")

    provider_id = provider["id"]
    access_token = provider["access_token"]
    success = False
    error_msg = None
    status_code = 500
    latency_ms = 0

    try:
        # Forward to Nous/Hermes API
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }

        # Build the upstream request
        upstream_body = {
            "model": model,
            "messages": messages,
        }
        if body.get("temperature") is not None:
            upstream_body["temperature"] = body["temperature"]
        if body.get("max_tokens") is not None:
            upstream_body["max_tokens"] = body["max_tokens"]
        if body.get("top_p") is not None:
            upstream_body["top_p"] = body["top_p"]
        if body.get("stream") is not None:
            upstream_body["stream"] = body["stream"]
        if body.get("stop") is not None:
            upstream_body["stop"] = body["stop"]

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{settings.nous_api_base}/chat/completions",
                headers=headers,
                json=upstream_body,
            )

        latency_ms = int((time.time() - start) * 1000)
        status_code = resp.status_code
        success = 200 <= status_code < 300

        if not success:
            error_msg = resp.text[:500]
            logger.error(f"Upstream error from provider {provider['account_label']}: {status_code} {error_msg}")
            raise HTTPException(status_code=status_code, detail=f"Upstream error: {error_msg}")

        # Parse response for token counts
        resp_data = resp.json()
        usage = resp_data.get("usage", {})
        prompt_tokens = usage.get("prompt_tokens", 0)
        completion_tokens = usage.get("completion_tokens", 0)
        total_tokens = usage.get("total_tokens", 0)

        # Log successful request
        await log_request(
            account_id=auth["account_id"],
            api_key_id=auth["api_key_id"],
            provider_id=provider_id,
            model=model,
            status_code=status_code,
            latency_ms=latency_ms,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )

        return Response(
            content=resp.content,
            status_code=status_code,
            media_type="application/json",
        )

    except HTTPException:
        raise

    except Exception as e:
        latency_ms = int((time.time() - start) * 1000)
        error_msg = str(e)[:500]
        logger.error(f"Chat completion error: {error_msg}")

        # Log failed request
        await log_request(
            account_id=auth["account_id"],
            api_key_id=auth["api_key_id"],
            provider_id=provider_id,
            model=model,
            status_code=status_code,
            latency_ms=latency_ms,
            error_message=error_msg,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )

        raise HTTPException(status_code=500, detail=f"Internal error: {error_msg}")

    finally:
        await release_provider(provider_id, success, error_msg)
