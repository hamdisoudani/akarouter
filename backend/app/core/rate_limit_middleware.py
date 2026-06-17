"""Helpers for applying rate limits in FastAPI route handlers.

Usage in a route handler:

    from app.core.rate_limit_middleware import enforce_rate_limit, client_ip

    @router.post("/v1/chat/completions")
    async def proxy_chat(req: Request):
        # ... existing code ...
        # Rate limit per-API-key. Must come AFTER auth so we know
        # which account/key is calling.
        rl = await enforce_rate_limit(
            req,
            scope="chat.api_key",
            identifier=authenticated_key_id,  # set by the auth middleware
            tier=account.tier,                # used to pick the limit
        )
        if not rl.allowed:
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded",
                headers=rl.to_headers(),
            )
        response.headers.update(rl.to_headers())
        # ... rest of the handler ...
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import HTTPException, Request

from app.core.rate_limit import (
    RateLimitResult,
    get_endpoint_ip_limit,
    get_tier_limit,
)

logger = logging.getLogger(__name__)


def client_ip(request: Request) -> str:
    """Extract the real client IP, accounting for reverse proxies.

    Trust order:
      1. X-Forwarded-For (leftmost = original client). Railway and
         Cloudflare set this correctly. We use the leftmost because
         that's the original sender; subsequent entries are proxies
         the request passed through. (Some implementations use the
         rightmost but that's the nearest proxy, which is less useful.)
      2. X-Real-IP (set by nginx-style proxies)
      3. request.client.host (direct connection)
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        # Take the first IP. It can be a comma-separated list. Strip whitespace.
        first = xff.split(",")[0].strip()
        if first:
            return first
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def get_rate_limiter(request: Request):
    """Pull the rate limiter singleton from app.state, or None if disabled."""
    return getattr(request.app.state, "rate_limiter", None)


async def enforce_rate_limit(
    request: Request,
    *,
    scope: str,
    identifier: str,
    limit: int,
    window_seconds: int,
) -> RateLimitResult:
    """Apply a rate limit. Returns the result so callers can attach
    X-RateLimit-* headers even on success.

    NEVER raises — the rate limiter is fail-soft. If the limiter is
    missing (e.g. tests that didn't initialize app.state) or throws
    unexpectedly, the request is allowed and a warning is logged.
    """
    limiter = get_rate_limiter(request)
    if limiter is None:
        return RateLimitResult(allowed=True, limit=limit, remaining=limit, reset_in=window_seconds, retry_after=0)
    try:
        return await limiter.check(scope, identifier, limit, window_seconds)
    except Exception as e:
        # Fail-soft: never block a request because of a rate-limiter bug.
        logger.warning("rate limiter check failed (scope=%s): %s", scope, e)
        return RateLimitResult(allowed=True, limit=limit, remaining=limit, reset_in=window_seconds, retry_after=0)


async def enforce_tier_rate_limit(
    request: Request,
    *,
    scope: str,
    identifier: str,
    tier: str,
) -> RateLimitResult:
    """Apply a per-tier limit. Pulls the limit from TIER_RATE_LIMITS based on tier."""
    limit, window = get_tier_limit(tier)
    return await enforce_rate_limit(
        request, scope=scope, identifier=identifier, limit=limit, window_seconds=window,
    )


async def enforce_ip_rate_limit(
    request: Request,
    *,
    endpoint: str,
) -> RateLimitResult:
    """Apply a per-IP limit for a named endpoint. Use for unauthenticated routes."""
    limit, window = get_endpoint_ip_limit(endpoint)
    return await enforce_rate_limit(
        request,
        scope=f"ip.{endpoint}",
        identifier=client_ip(request),
        limit=limit,
        window_seconds=window,
    )


def rate_limit_429(result: RateLimitResult) -> HTTPException:
    """Build the standard 429 response with X-RateLimit-* headers."""
    return HTTPException(
        status_code=429,
        detail="Rate limit exceeded",
        headers=result.to_headers(),
    )
