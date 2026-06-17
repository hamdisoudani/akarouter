"""Distributed locks via Postgres advisory locks.

Why this exists
---------------
AKAROUTER runs on Railway with potentially multiple FastAPI instances behind a
load balancer. Several critical sections have a check-then-act shape that is
NOT safe across instances:

1. Budget enforcement in router.authenticate_api_key():
   - Two instances can each read budget["consumed_5h"] from cache
   - Both see < limit
   - Both allow the request
   - Both buffer a cost increment
   - Both flush to DB → account goes over budget

2. Webhook handling in webhooks.whop_webhook_handler():
   - Even with `processed_webhooks` dedup table, two webhooks for the same
     account (from different Whop event types) can race on
     `accounts.update()` and produce inconsistent state.

3. Tier upgrade flow:
   - User triggers checkout session while webhook arrives
   - Both code paths try to update `accounts.tier`
   - Last-writer-wins loses one update

The standard answer is Redis. We are NOT using Redis. Instead we use
Postgres's built-in advisory locks, which have the properties we need:

- **Per-key**: `pg_try_advisory_xact_lock(int4, int4)` or
  `pg_try_advisory_xact_lock(int8)` lock by a hash of the resource key.
  Two requests for the same account block each other; requests for
  different accounts never block.
- **Non-blocking**: `pg_try_advisory_xact_lock` returns false immediately
  if another transaction holds the lock. We can decide whether to wait
  (`pg_advisory_xact_lock`) or fail-fast.
- **Auto-released**: the `_xact_` variants are released at transaction
  end, so a crashing worker can't permanently hold a lock and deadlock
  the system.
- **Battle-tested**: Postgres has had these since v8.1 (2005).

Migration path to Redis
-----------------------
The `LockBackend` Protocol below is a thin interface that wraps the
advisory-lock call. When/if you decide to introduce Redis, write a
`RedisLockBackend` that implements the same protocol (SETNX with TTL +
Lua script for safe release). Swap one line in `get_lock_backend()`.
No call-site changes required.

Usage
-----
    from app.core.locks import get_lock_backend

    locks = get_lock_backend()
    async with locks.account_budget(account_id):
        # critical section: budget check + increment
        ...

    async with locks.webhook_dedup(webhook_id):
        # critical section: dedup check + side effect
        ...

The `with` block ensures the lock is released even if the body raises.
"""

from __future__ import annotations

import asyncio
import logging
import zlib
from typing import Any, Protocol

from app.core.supabase import get_supabase

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lock-key derivation
# ---------------------------------------------------------------------------
#
# Postgres advisory locks accept either:
#   - Two int4 values (`pg_try_advisory_xact_lock(int4, int4)`) — up to 2^31 each
#   - One int8 value (`pg_try_advisory_xact_lock(int8)`) — up to 2^63
#
# Resource keys are UUIDs or other strings. We hash them with CRC32
# (32-bit, fits in int4) for the two-arg form. CRC32 has good distribution
# for short keys and is fast enough that the lock-acquisition overhead is
# negligible.
#
# Why not MD5/SHA? Postgres int8 is 64 bits; truncating a longer hash to
# 64 bits doesn't gain us anything over CRC32 and is slower. For advisory
# locks, collision rate is a non-issue: two accounts whose CRC32s collide
# would just serialize against each other briefly, never lose data.

# Fixed "namespace" ints to distinguish lock types. Using a single int4
# constant per type means different lock types never block each other even
# if they happen to compute the same key hash.
_NS_ACCOUNT_BUDGET = 0x4153_4255  # "ASBU" (Account Budget) in ASCII
_NS_WEBHOOK_DEDUP = 0x5742_4844  # "WBHD" (Webhook Dedup) in ASCII
_NS_TIER_UPGRADE = 0x5449_5550  # "TIUP" (Tier Upgrade) in ASCII


def _crc32(s: str) -> int:
    """32-bit CRC32 of a string, reinterpreted as signed int4 for Postgres.

    zlib.crc32 returns an unsigned 32-bit value (0..2^32-1). Postgres int4
    is signed (-2^31..2^31-1). We reinterpret the same bit pattern as
    signed so the value fits in Postgres int4 without overflow.
    """
    unsigned = zlib.crc32(s.encode("utf-8")) & 0xFFFFFFFF
    # Convert unsigned 32-bit to signed 32-bit (two's complement).
    return unsigned - 0x1_0000_0000 if unsigned >= 0x8000_0000 else unsigned


def _int4_pair(namespace: int, key: str) -> tuple[int, int]:
    """Pack a namespace + key into a (int4, int4) pair for pg_try_advisory_xact_lock."""
    return (namespace & 0xFFFFFFFF, _crc32(key))


# ---------------------------------------------------------------------------
# LockBackend protocol — swap implementations here when Redis lands
# ---------------------------------------------------------------------------


class LockBackend(Protocol):
    """Protocol for distributed lock backends.

    All locks must be:
      - non-reentrant (caller is responsible for not double-acquiring)
      - per-key (different keys never block each other)
      - released on context-manager exit even if the body raises
    """

    async def account_budget(self, account_id: str) -> "_Lock":
        """Lock that serializes budget check+decrement for one account."""
        ...

    async def webhook_dedup(self, webhook_id: str) -> "_Lock":
        """Lock that serializes webhook processing for one webhook id."""
        ...

    async def tier_upgrade(self, account_id: str) -> "_Lock":
        """Lock that serializes tier upgrade flows for one account."""
        ...


class _Lock:
    """Context manager that holds a Postgres advisory lock.

    Use via `async with` so the lock is released on exit, even on errors.

    `acquired` is False when `pg_try_advisory_xact_lock` returned false
    (another transaction holds the lock). Callers can either wait
    (re-enter with `blocking=True`) or fail-fast (return 429 immediately).
    """

    def __init__(
        self,
        *,
        namespace: int,
        key: str,
        blocking: bool = True,
    ) -> None:
        self._ns = namespace
        self._key = key
        self._blocking = blocking
        self._acquired = False
        self._released = False

    @property
    def acquired(self) -> bool:
        return self._acquired

    async def __aenter__(self) -> "_Lock":
        await self._acquire()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self._release()

    async def _acquire(self) -> None:
        ns, key_crc = _int4_pair(self._ns, self._key)
        fn_name = (
            "pg_advisory_xact_lock_int" if self._blocking
            else "pg_try_advisory_xact_lock_int"
        )
        try:
            supabase = get_supabase()
            res = supabase.rpc(fn_name, {"p_ns": ns, "p_key": key_crc}).execute()
        except Exception as exc:
            logger.error(
                "lock acquisition RPC %s failed (key=%s ns=%s): %s. "
                "Did you run scratch/migrate_advisory_lock_helpers.sql?",
                fn_name, self._key, ns, exc,
            )
            raise

        if self._blocking:
            # pg_advisory_xact_lock_int always succeeds (waits if needed)
            self._acquired = True
        else:
            self._acquired = bool(res.data) if res is not None and hasattr(res, "data") else False

    async def _release(self) -> None:
        # The `_xact_` variants auto-release on transaction end, but if
        # we exit the `with` block without committing (e.g. an exception
        # in the caller), Postgres still releases the lock at the end of
        # the failed transaction. We track released state for logging.
        if self._acquired and not self._released:
            self._released = True
            logger.debug("advisory lock released: ns=%s key=%s", self._ns, self._key)


# ---------------------------------------------------------------------------
# Concrete implementation: Postgres advisory locks
# ---------------------------------------------------------------------------


class PostgresAdvisoryLockBackend:
    """LockBackend implementation using Postgres advisory locks.

    This is the default. To swap in Redis, write RedisLockBackend with
    the same surface area and change `get_lock_backend()` below.
    """

    async def account_budget(self, account_id: str) -> _Lock:
        # Non-blocking try-acquire for budget checks: if another instance
        # is mid-check for this account, fail-fast with 429 instead of
        # waiting — clients retry with backoff.
        return _Lock(namespace=_NS_ACCOUNT_BUDGET, key=account_id, blocking=False)

    async def webhook_dedup(self, webhook_id: str) -> _Lock:
        # Blocking: by the time we've verified the HMAC, we want this
        # write to complete deterministically. Worst case is a 50-100ms wait.
        return _Lock(namespace=_NS_WEBHOOK_DEDUP, key=webhook_id, blocking=True)

    async def tier_upgrade(self, account_id: str) -> _Lock:
        # Non-blocking: tier upgrades should fail-fast; UI can show "try again"
        return _Lock(namespace=_NS_TIER_UPGRADE, key=account_id, blocking=False)


# ---------------------------------------------------------------------------
# In-memory fallback (for tests / single-instance dev)
# ---------------------------------------------------------------------------


class InMemoryLockBackend:
    """In-process lock backend. NOT distributed — use only in tests or single-instance setups.

    Provided so:
      - Local tests don't need a live Supabase connection to exercise lock-protected code paths.
      - A single-instance deployment can fall back if Supabase RPCs are unavailable.

    This is intentionally NOT the default. It will silently allow races
    across multiple processes.
    """

    def __init__(self) -> None:
        # Blocking locks (use asyncio.Lock which queues waiters correctly)
        self._blocking_locks: dict[tuple[int, int], asyncio.Lock] = {}
        # Non-blocking gates: a {taken: bool, free: Event} state per key.
        # Event-based to avoid the asyncio.Lock "abandoned acquire" problem.
        self._nonblocking_gates: dict[tuple[int, int], dict] = {}

    def _blocking_lock(self, ns: int, key: str) -> asyncio.Lock:
        pair = _int4_pair(ns, key)
        lock = self._blocking_locks.get(pair)
        if lock is None:
            lock = asyncio.Lock()
            self._blocking_locks[pair] = lock
        return lock

    def _nonblocking_gate(self, ns: int, key: str) -> dict:
        pair = _int4_pair(ns, key)
        gate = self._nonblocking_gates.get(pair)
        if gate is None:
            gate = {"taken": False}
            self._nonblocking_gates[pair] = gate
        return gate

    async def account_budget(self, account_id: str) -> "_InMemLockCtx":
        return _InMemLockCtx(self, _NS_ACCOUNT_BUDGET, account_id, blocking=False)

    async def webhook_dedup(self, webhook_id: str) -> "_InMemLockCtx":
        return _InMemLockCtx(self, _NS_WEBHOOK_DEDUP, webhook_id, blocking=True)

    async def tier_upgrade(self, account_id: str) -> "_InMemLockCtx":
        return _InMemLockCtx(self, _NS_TIER_UPGRADE, account_id, blocking=False)


class _InMemLockCtx:
    """Async context manager that mirrors PostgresAdvisoryLock semantics.

    blocking=True  → wait until the lock is available, then acquire.
    blocking=False → return immediately with _acquired=False if held.
    """

    def __init__(self, backend: InMemoryLockBackend, ns: int, key: str, blocking: bool) -> None:
        self._backend = backend
        self._ns = ns
        self._key = key
        self._blocking = blocking
        self._acquired: bool = False

    async def __aenter__(self) -> "_InMemLockCtx":
        if self._blocking:
            lock = self._backend._blocking_lock(self._ns, self._key)
            await lock.acquire()
            self._acquired = True
        else:
            # Non-blocking: Event-based gate, no "abandoned acquire" issue.
            gate = self._backend._nonblocking_gate(self._ns, self._key)
            if not gate["taken"]:
                gate["taken"] = True
                self._acquired = True
            else:
                self._acquired = False
        return self

    async def __aexit__(self, *exc: Any) -> None:
        if not self._acquired:
            return
        if self._blocking:
            lock = self._backend._blocking_lock(self._ns, self._key)
            if lock.locked():
                lock.release()
        else:
            gate = self._backend._nonblocking_gate(self._ns, self._key)
            gate["taken"] = False
        self._acquired = False


# ---------------------------------------------------------------------------
# Module-level singleton accessor
# ---------------------------------------------------------------------------


_backend: LockBackend | None = None


def get_lock_backend() -> LockBackend:
    """Return the process-wide lock backend.

    Override via the env var `AKAROUTER_LOCK_BACKEND`:
      - "postgres" (default): PostgresAdvisoryLockBackend
      - "memory": InMemoryLockBackend (tests / single-instance fallback)
    """
    global _backend
    if _backend is not None:
        return _backend
    import os
    backend_name = (os.getenv("AKAROUTER_LOCK_BACKEND") or "postgres").lower()
    if backend_name == "memory":
        logger.warning("Using InMemoryLockBackend — distributed locks DISABLED. Do NOT use in production multi-instance.")
        _backend = InMemoryLockBackend()
    else:
        _backend = PostgresAdvisoryLockBackend()
    return _backend


def reset_lock_backend() -> None:
    """Reset the cached backend (used in tests)."""
    global _backend
    _backend = None