"""Tests for app.core.rate_limit (in-memory sliding-window limiter).

Covers:
  - basic allow/deny behavior
  - sliding-window eviction (events older than the window don't count)
  - per-(scope, identifier) bucket isolation
  - headers and RateLimitResult semantics
  - tier and endpoint lookup helpers
  - reset() clears a bucket
  - size() reflects bucket count
  - rate_limit_middleware helpers (client_ip extraction, fail-soft)
"""
import asyncio
import pytest
import time

from app.core.rate_limit import (
    InMemoryRateLimiter,
    RateLimitResult,
    TIER_RATE_LIMITS,
    ENDPOINT_IP_LIMITS,
    get_tier_limit,
    get_endpoint_ip_limit,
)
from app.core.rate_limit_middleware import (
    client_ip,
    enforce_rate_limit,
    enforce_tier_rate_limit,
    enforce_ip_rate_limit,
    rate_limit_429,
)


# ───────────────────────────────────────────────────────────────────
# Core: InMemoryRateLimiter
# ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_allows_under_limit():
    rl = InMemoryRateLimiter()
    for i in range(5):
        r = await rl.check("chat", "key-1", limit=5, window_seconds=60)
        assert r.allowed is True
        assert r.remaining == 5 - (i + 1)
        assert r.retry_after == 0


@pytest.mark.asyncio
async def test_blocks_at_limit():
    rl = InMemoryRateLimiter()
    for _ in range(3):
        r = await rl.check("chat", "key-1", limit=3, window_seconds=60)
        assert r.allowed is True
    r = await rl.check("chat", "key-1", limit=3, window_seconds=60)
    assert r.allowed is False
    assert r.remaining == 0
    assert r.retry_after > 0
    assert r.retry_after <= 60


@pytest.mark.asyncio
async def test_sliding_window_evicts_old_events():
    rl = InMemoryRateLimiter()
    # Limit 2 over 1 second window
    for _ in range(2):
        r = await rl.check("chat", "key-1", limit=2, window_seconds=1)
        assert r.allowed is True
    # Third is blocked
    r = await rl.check("chat", "key-1", limit=2, window_seconds=1)
    assert r.allowed is False
    # After 1.1s, the window has fully decayed and we should be allowed again
    await asyncio.sleep(1.1)
    r = await rl.check("chat", "key-1", limit=2, window_seconds=1)
    assert r.allowed is True


@pytest.mark.asyncio
async def test_buckets_isolated_by_scope():
    rl = InMemoryRateLimiter()
    # Exhaust "chat" bucket
    for _ in range(3):
        await rl.check("chat", "key-1", limit=3, window_seconds=60)
    r = await rl.check("chat", "key-1", limit=3, window_seconds=60)
    assert r.allowed is False
    # "models" bucket is independent
    r = await rl.check("models", "key-1", limit=3, window_seconds=60)
    assert r.allowed is True


@pytest.mark.asyncio
async def test_buckets_isolated_by_identifier():
    rl = InMemoryRateLimiter()
    for _ in range(2):
        await rl.check("chat", "key-1", limit=2, window_seconds=60)
    r = await rl.check("chat", "key-1", limit=2, window_seconds=60)
    assert r.allowed is False
    # Different key, same scope — independent bucket
    r = await rl.check("chat", "key-2", limit=2, window_seconds=60)
    assert r.allowed is True


@pytest.mark.asyncio
async def test_reset_clears_bucket():
    rl = InMemoryRateLimiter()
    for _ in range(5):
        await rl.check("chat", "key-1", limit=5, window_seconds=60)
    r = await rl.check("chat", "key-1", limit=5, window_seconds=60)
    assert r.allowed is False
    await rl.reset("chat", "key-1")
    r = await rl.check("chat", "key-1", limit=5, window_seconds=60)
    assert r.allowed is True


@pytest.mark.asyncio
async def test_size_reflects_buckets():
    rl = InMemoryRateLimiter()
    assert await rl.size() == 0
    await rl.check("a", "1", limit=10, window_seconds=60)
    await rl.check("a", "2", limit=10, window_seconds=60)
    await rl.check("b", "1", limit=10, window_seconds=60)
    assert await rl.size() == 3
    await rl.reset("a", "1")
    assert await rl.size() == 2


@pytest.mark.asyncio
async def test_concurrent_requests_respect_limit():
    """50 concurrent requests against a 10-req/min limit should allow
    exactly 10 and block exactly 40. Tests the asyncio.Lock."""
    rl = InMemoryRateLimiter()
    results = await asyncio.gather(*[
        rl.check("chat", "key-1", limit=10, window_seconds=60)
        for _ in range(50)
    ])
    allowed = [r for r in results if r.allowed]
    blocked = [r for r in results if not r.allowed]
    assert len(allowed) == 10
    assert len(blocked) == 40


@pytest.mark.asyncio
async def test_zero_limit_always_blocks():
    rl = InMemoryRateLimiter()
    r = await rl.check("chat", "key-1", limit=0, window_seconds=60)
    assert r.allowed is False


@pytest.mark.asyncio
async def test_zero_window_always_allows():
    rl = InMemoryRateLimiter()
    for _ in range(100):
        r = await rl.check("chat", "key-1", limit=1, window_seconds=0)
        assert r.allowed is True


# ───────────────────────────────────────────────────────────────────
# RateLimitResult headers
# ───────────────────────────────────────────────────────────────────

def test_headers_on_success():
    r = RateLimitResult(allowed=True, limit=60, remaining=42, reset_in=30, retry_after=0)
    h = r.to_headers()
    assert h["X-RateLimit-Limit"] == "60"
    assert h["X-RateLimit-Remaining"] == "42"
    assert h["X-RateLimit-Reset"] == "30"  # ceil(30.0)
    assert h["Retry-After"] == "0"


def test_headers_on_block():
    r = RateLimitResult(allowed=False, limit=60, remaining=0, reset_in=15.4, retry_after=15.4)
    h = r.to_headers()
    assert h["X-RateLimit-Limit"] == "60"
    assert h["X-RateLimit-Remaining"] == "0"
    assert h["X-RateLimit-Reset"] == "16"  # ceil(15.4)
    assert h["Retry-After"] == "16"        # ceil(15.4)


def test_headers_remaining_clamped_to_zero():
    """Defensive: if remaining somehow went negative, the header is 0, not -3."""
    r = RateLimitResult(allowed=False, limit=10, remaining=-3, reset_in=5, retry_after=5)
    assert r.to_headers()["X-RateLimit-Remaining"] == "0"


# ───────────────────────────────────────────────────────────────────
# Tier and endpoint lookup
# ───────────────────────────────────────────────────────────────────

def test_tier_limits_cover_all_documented_tiers():
    for tier in ("free", "starter", "pro", "ultra"):
        assert tier in TIER_RATE_LIMITS


def test_get_tier_limit_known_tier():
    assert get_tier_limit("pro") == (120, 60)


def test_get_tier_limit_unknown_tier_falls_back_to_free():
    assert get_tier_limit("enterprise") == (20, 60)
    assert get_tier_limit("") == (20, 60)


def test_get_endpoint_ip_limit_known():
    assert get_endpoint_ip_limit("v1.models") == (30, 60)
    assert get_endpoint_ip_limit("user.revoke_key") == (5, 60)


def test_get_endpoint_ip_limit_unknown_falls_back_to_safe_default():
    limit, window = get_endpoint_ip_limit("unknown.endpoint")
    assert limit == 60
    assert window == 60


# ───────────────────────────────────────────────────────────────────
# Middleware helpers
# ───────────────────────────────────────────────────────────────────

def test_client_ip_from_xff():
    class FakeRequest:
        headers = {"x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2"}
        client = type("C", (), {"host": "127.0.0.1"})()

    assert client_ip(FakeRequest()) == "203.0.113.5"


def test_client_ip_from_xff_single_value():
    class FakeRequest:
        headers = {"x-forwarded-for": "198.51.100.1"}
        client = type("C", (), {"host": "127.0.0.1"})()

    assert client_ip(FakeRequest()) == "198.51.100.1"


def test_client_ip_from_x_real_ip():
    class FakeRequest:
        headers = {"x-real-ip": "203.0.113.42"}
        client = type("C", (), {"host": "127.0.0.1"})()

    assert client_ip(FakeRequest()) == "203.0.113.42"


def test_client_ip_from_request_client_when_no_headers():
    class FakeRequest:
        headers = {}
        client = type("C", (), {"host": "127.0.0.1"})()

    assert client_ip(FakeRequest()) == "127.0.0.1"


def test_client_ip_unknown_when_nothing():
    class FakeRequest:
        headers = {}
        client = None

    assert client_ip(FakeRequest()) == "unknown"


@pytest.mark.asyncio
async def test_enforce_rate_limit_without_limiter_allows():
    """If app.state.rate_limiter is missing (e.g. tests that didn't
    initialize it), the helper fails-soft and allows the request."""
    class FakeApp:
        class state:
            pass  # no rate_limiter attribute

    class FakeRequest:
        app = FakeApp()
        headers = {}

    r = await enforce_rate_limit(
        FakeRequest(),
        scope="test",
        identifier="x",
        limit=1,
        window_seconds=60,
    )
    assert r.allowed is True


@pytest.mark.asyncio
async def test_enforce_tier_rate_limit_uses_tier_table():
    """The pro tier should yield 120 req/min; the free tier should
    block at 20."""
    from app.core.rate_limit import InMemoryRateLimiter

    class FakeApp:
        class state:
            rate_limiter = InMemoryRateLimiter()

    class FakeRequest:
        app = FakeApp()
        headers = {}

    # 25 requests against a "free" tier should be blocked at 20
    blocked_count = 0
    for _ in range(25):
        r = await enforce_tier_rate_limit(
            FakeRequest(),
            scope="chat",
            identifier="key-1",
            tier="free",
        )
        if not r.allowed:
            blocked_count += 1
    assert blocked_count == 5  # 25 requests - 20 allowed = 5 blocked


@pytest.mark.asyncio
async def test_enforce_ip_rate_limit_uses_endpoint_table():
    from app.core.rate_limit import InMemoryRateLimiter

    class FakeApp:
        class state:
            rate_limiter = InMemoryRateLimiter()

    class FakeRequest:
        app = FakeApp()
        headers = {"x-forwarded-for": "1.2.3.4"}

    # 35 requests against v1.models (30/min limit) from the same IP
    blocked = 0
    for _ in range(35):
        r = await enforce_ip_rate_limit(FakeRequest(), endpoint="v1.models")
        if not r.allowed:
            blocked += 1
    assert blocked == 5  # 35 - 30 = 5


def test_rate_limit_429_includes_headers():
    """The exception returned by rate_limit_429 must carry the
    X-RateLimit-* and Retry-After headers so FastAPI emits them."""
    from fastapi import HTTPException

    r = RateLimitResult(allowed=False, limit=10, remaining=0, reset_in=5, retry_after=5)
    exc = rate_limit_429(r)
    assert isinstance(exc, HTTPException)
    assert exc.status_code == 429
    assert exc.headers["X-RateLimit-Limit"] == "10"
    assert exc.headers["X-RateLimit-Remaining"] == "0"
    assert "Retry-After" in exc.headers
