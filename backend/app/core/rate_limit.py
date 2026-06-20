"""Token-bucket rate limiting with a sliding-window log.

Design:
  - One RateLimiter instance is created at app startup and stored on
    `app.state.rate_limiter` so route handlers can pull it via
    `request.app.state.rate_limiter`. This is the same pattern as the
    LockBackend, HTTP client pool, and flusher task.
  - Per-bucket state is a deque of request timestamps. A new request
    appends to the deque, evicts anything older than `window_seconds`,
    and returns a (allowed, remaining, reset_in) tuple.
  - Buckets are keyed by (scope, identifier) tuples. Scopes separate
    "rate-limit buckets" so the same key doesn't share a counter
    across endpoints. E.g. a hot `/v1/models` doesn't throttle
    `/v1/chat/completions`.
  - Memory: each bucket holds at most `limit` timestamps. With 1K
    unique keys × 7 scopes × 100 events = 700K floats. ~6 MB at
    typical load. Negligible.
  - This is an in-memory implementation. It does NOT share state
    across backend instances. That is acceptable for a single-instance
    Railway deploy. A future Redis implementation can be dropped in
    behind the same `RateLimiter` Protocol (mirroring LockBackend).

Why sliding-window log over fixed window or token bucket:
  - Fixed window: 2x burst at window boundary, no smooth decay.
  - Token bucket: smooth decay but at low rates the bucket fills
    and stays full indefinitely, so a key that hasn't been used
    in a while can fire `burst + rate` requests instantly.
  - Sliding log: exact count over the window, no boundary spikes.
    The cost is O(n) memory per bucket where n = limit, but limits
    are small (≤300/min for ultra) so this is fine.
"""
from __future__ import annotations

import asyncio
import math
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, Protocol, Tuple


@dataclass
class RateLimitResult:
    """The outcome of a rate-limit check.

    Mirrors the standard X-RateLimit-* headers (RFC 6585 / draft-ietf-httpapi-ratelimit-headers).
    """
    allowed: bool
    limit: int
    remaining: int        # requests left in the current window after this one
    reset_in: float       # seconds until the window has fully decayed
    retry_after: float    # seconds until the next request would be allowed (0 if allowed)

    def to_headers(self) -> Dict[str, str]:
        """Map to the standard X-RateLimit-* headers for HTTP responses.

        Uses math.ceil because the spec (draft-ietf-httpapi-ratelimit-headers)
        defines these as "seconds until reset" — a fractional value would
        require clients to parse floats. Whole numbers only.
        """
        return {
            "X-RateLimit-Limit": str(self.limit),
            "X-RateLimit-Remaining": str(max(0, self.remaining)),
            "X-RateLimit-Reset": str(math.ceil(self.reset_in)),
            "Retry-After": str(math.ceil(self.retry_after)) if not self.allowed else "0",
        }


class RateLimiter(Protocol):
    """Protocol so the in-memory implementation can be swapped for Redis
    later (mirroring the LockBackend pattern) without touching call sites."""

    async def check(self, scope: str, identifier: str, limit: int, window_seconds: int) -> RateLimitResult:
        """Atomically check + record a hit. Returns the result. NEVER raises."""
        ...

    async def reset(self, scope: str, identifier: str) -> None:
        """Forget all history for a (scope, identifier). Used when a key is revoked."""
        ...

    async def size(self) -> int:
        """Number of buckets currently in memory. Used for observability / tests."""
        ...


@dataclass
class _Bucket:
    timestamps: Deque[float] = field(default_factory=deque)


class InMemoryRateLimiter:
    """Sliding-window log rate limiter.

    Coroutine safety: all mutation happens under a single `asyncio.Lock`.
    The lock is per-RateLimiter (not per-bucket) because the critical
    section is O(limit) deque ops — fast enough that contention is a
    non-issue. If contention ever shows up in profiles, swap to a
    `dict[Tuple[str, str], asyncio.Lock]` keyed by bucket.
    """

    def __init__(self) -> None:
        self._buckets: Dict[Tuple[str, str], _Bucket] = {}
        self._lock = asyncio.Lock()

    async def check(self, scope: str, identifier: str, limit: int, window_seconds: int) -> RateLimitResult:
        # Cap limit and window to sane bounds to prevent abuse via
        # misconfiguration. limit=0 means "always block", window=0 means
        # "always allowed" — both are valid configurations but easy to
        # typo.
        if limit <= 0:
            return RateLimitResult(allowed=False, limit=limit, remaining=0, reset_in=0, retry_after=window_seconds)
        if window_seconds <= 0:
            return RateLimitResult(allowed=True, limit=limit, remaining=limit, reset_in=0, retry_after=0)

        key = (scope, identifier)
        now = time.monotonic()
        cutoff = now - window_seconds

        async with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                bucket = _Bucket()
                self._buckets[key] = bucket

            # Evict entries older than the window. The deque is
            # monotonically increasing in insertion time, so once we
            # see an entry newer than cutoff we can stop.
            while bucket.timestamps and bucket.timestamps[0] <= cutoff:
                bucket.timestamps.popleft()

            current_count = len(bucket.timestamps)
            if current_count >= limit:
                # Block: the oldest entry will fall out of the window
                # in `oldest_age` seconds, which is when the next
                # request can be served.
                oldest = bucket.timestamps[0]
                retry_after = max(0.0, (oldest + window_seconds) - now)
                return RateLimitResult(
                    allowed=False,
                    limit=limit,
                    remaining=0,
                    reset_in=retry_after,
                    retry_after=retry_after,
                )

            # Allowed: record this hit and return the remaining count.
            bucket.timestamps.append(now)
            remaining = limit - len(bucket.timestamps)
            reset_in = (
                window_seconds
                if not bucket.timestamps
                else max(0.0, (bucket.timestamps[0] + window_seconds) - now)
            )
            return RateLimitResult(
                allowed=True,
                limit=limit,
                remaining=remaining,
                reset_in=reset_in,
                retry_after=0.0,
            )

    async def reset(self, scope: str, identifier: str) -> None:
        key = (scope, identifier)
        async with self._lock:
            self._buckets.pop(key, None)

    async def size(self) -> int:
        async with self._lock:
            return len(self._buckets)


# Per-tier rate limit presets. Tuned to be lenient on legit usage
# (a developer running an agent at 1 req/sec for a long task uses
# ~60 req/min, well within "pro" tier), while being strict enough
# to catch a stolen key firing 1000 req/min.
TIER_RATE_LIMITS: Dict[str, Dict[str, int]] = {
    "free":     {"limit": 20,  "window_seconds": 60},
    "starter":  {"limit": 60,  "window_seconds": 60},
    "pro":      {"limit": 120, "window_seconds": 60},
    "ultra":    {"limit": 300, "window_seconds": 60},
}

# Per-endpoint rate limit presets (where the bucket is per-IP,
# not per-tier, because no auth is required).
ENDPOINT_IP_LIMITS: Dict[str, Dict[str, int]] = {
    "auth.login":        {"limit": 10,  "window_seconds": 60},
    "v1.models":         {"limit": 30,  "window_seconds": 60},
    "v1.plans":          {"limit": 30,  "window_seconds": 60},
    "user.revoke_key":   {"limit": 5,   "window_seconds": 60},
    "user.create_key":   {"limit": 5,   "window_seconds": 60},
    "user.activate":     {"limit": 5,   "window_seconds": 60},
    "user.usage":        {"limit": 60,  "window_seconds": 60},
    "user.analytics":    {"limit": 10,  "window_seconds": 60},
    "user.point_transactions": {"limit": 30, "window_seconds": 60},
}


def get_tier_limit(tier: str) -> Tuple[int, int]:
    """Return (limit, window_seconds) for a given tier. Falls back to free."""
    cfg = TIER_RATE_LIMITS.get(tier) or TIER_RATE_LIMITS["free"]
    return cfg["limit"], cfg["window_seconds"]


def get_endpoint_ip_limit(endpoint: str) -> Tuple[int, int]:
    """Return (limit, window_seconds) for a given endpoint scope. Falls back to a safe default."""
    cfg = ENDPOINT_IP_LIMITS.get(endpoint)
    if cfg is None:
        # Safe default: 60 req/min. If a new endpoint isn't listed here it
        # still gets protected, just not tightened.
        return 60, 60
    return cfg["limit"], cfg["window_seconds"]
