"""Tests for the distributed lock module.

These tests focus on the InMemoryLockBackend (the deterministic, no-network
fallback) so we can verify serialization semantics without needing a live
Supabase connection. The PostgresAdvisoryLockBackend has the same surface
area but delegates to RPCs; it's exercised in integration tests.
"""
import asyncio

from app.core.locks import (
    InMemoryLockBackend,
    PostgresAdvisoryLockBackend,
    _crc32,
    _int4_pair,
    _NS_ACCOUNT_BUDGET,
    _NS_WEBHOOK_DEDUP,
    _NS_TIER_UPGRADE,
    get_lock_backend,
    reset_lock_backend,
)


# ---------------------------------------------------------------------------
# Key derivation
# ---------------------------------------------------------------------------


def test_crc32_is_stable():
    assert _crc32("test-account") == _crc32("test-account")
    assert _crc32("test-account") != _crc32("test-other")


def test_int4_pair_namespaces_differ():
    """Different lock namespaces must produce different (ns, key) pairs even for the same key string."""
    a = _int4_pair(_NS_ACCOUNT_BUDGET, "user-1")
    b = _int4_pair(_NS_WEBHOOK_DEDUP, "user-1")
    c = _int4_pair(_NS_TIER_UPGRADE, "user-1")
    assert a[0] != b[0] != c[0]
    # ns is the first element of the tuple
    assert a[1] == b[1] == c[1]  # same key -> same hash, different ns


def test_int4_pair_within_int4_range():
    """Both values must fit in signed int4 (Postgres int4 type)."""
    for ns in (_NS_ACCOUNT_BUDGET, _NS_WEBHOOK_DEDUP, _NS_TIER_UPGRADE):
        for key in ("short", "x" * 1000, "🦀-emoji-key-🔒", "uuid-00000000-0000-0000-0000-000000000000"):
            ns_int, key_int = _int4_pair(ns, key)
            assert -2_147_483_648 <= ns_int <= 2_147_483_647, f"ns out of int4 for key={key}"
            assert -2_147_483_648 <= key_int <= 2_147_483_647, f"key out of int4 for key={key}"


# ---------------------------------------------------------------------------
# InMemoryLockBackend: blocking serialization
# ---------------------------------------------------------------------------


async def test_inmem_blocking_lock_serializes_critical_sections():
    """Two concurrent holders of the same blocking lock must serialize."""
    backend = InMemoryLockBackend()
    order: list[str] = []

    async def first():
        lock = await backend.webhook_dedup("webhook-1")
        async with lock:
            order.append("first:enter")
            await asyncio.sleep(0.05)
            order.append("first:exit")

    async def second():
        # Give first a head start
        await asyncio.sleep(0.01)
        lock = await backend.webhook_dedup("webhook-1")
        async with lock:
            order.append("second:enter")
            order.append("second:exit")

    await asyncio.gather(first(), second())

    # first must fully exit before second enters
    assert order == [
        "first:enter",
        "first:exit",
        "second:enter",
        "second:exit",
    ], f"expected serialized execution, got {order}"


async def test_inmem_nonblocking_lock_fails_fast_when_held():
    """A second holder of a non-blocking lock must see acquired=False."""
    backend = InMemoryLockBackend()
    entered = asyncio.Event()
    can_exit = asyncio.Event()

    async def first():
        lock = await backend.account_budget("account-1")
        async with lock:
            assert lock._acquired is True
            entered.set()
            await can_exit.wait()

    async def second():
        await entered.wait()
        lock = await backend.account_budget("account-1")
        async with lock:
            assert lock._acquired is False, "non-blocking lock should fail fast when held"

    first_task = asyncio.create_task(first())
    second_task = asyncio.create_task(second())
    # Let first enter and set the gate; then run second which should fail-fast
    await asyncio.sleep(0.05)
    assert second_task.done(), "second should have completed (failed-fast)"
    assert first_task.done() is False, "first should still be waiting on can_exit"
    # Release first
    can_exit.set()
    await first_task


async def test_inmem_locks_are_per_key():
    """Locks for different keys must NOT block each other."""
    backend = InMemoryLockBackend()
    order: list[str] = []
    can_proceed = asyncio.Event()

    async def first():
        lock = await backend.account_budget("account-1")
        async with lock:
            order.append("first:enter")
            await can_proceed.wait()
            order.append("first:exit")

    async def second():
        # Should run concurrently with first (different key)
        lock = await backend.account_budget("account-2")
        async with lock:
            order.append("second:enter")
            order.append("second:exit")
            can_proceed.set()

    await asyncio.gather(first(), second())

    # second should fully run before first exits
    assert order.index("second:enter") < order.index("first:exit")
    assert order.index("second:exit") < order.index("first:exit")


# ---------------------------------------------------------------------------
# Counter race scenario: the actual bug we're fixing
# ---------------------------------------------------------------------------


async def test_budget_counter_does_not_overspend_under_contention():
    """Reproduces the cross-instance budget race.

    Scenario: N concurrent 'spend' requests for the same account. Each adds
    a fixed cost. The lock + limit check must prevent the counter from
    exceeding LIMIT, no matter how contended the requests are.

    With non-blocking locks, simultaneous contenders see taken=True and
    fail-fast (matching real Postgres pg_try_advisory_xact_lock semantics).
    That means in a single gather(), exactly 1 of N concurrent requests
    enters the critical section. To simulate traffic over time, we issue
    requests in waves and verify the counter never exceeds LIMIT.
    """
    backend = InMemoryLockBackend()
    counter = 0  # integer cents to avoid float drift
    COST = 10
    LIMIT = 100

    async def spend_with_limit(account_id: str):
        nonlocal counter
        lock = await backend.account_budget(account_id)
        async with lock:
            acquired = getattr(lock, "acquired", None)
            if acquired is None:
                acquired = getattr(lock, "_acquired", True)
            if not acquired:
                return  # fail-fast
            if counter >= LIMIT:
                return
            await asyncio.sleep(0.001)
            counter += COST

    # Simulate 30 sequential batches. In each batch, multiple concurrent
    # requests compete; only one wins. Across batches, the counter advances.
    for _ in range(30):
        await asyncio.gather(*[spend_with_limit("acc-A") for _ in range(5)])
        # Counter must NEVER exceed LIMIT, no matter how many batches run
        assert counter <= LIMIT, f"counter={counter} exceeded LIMIT={LIMIT}"

    # Counter should eventually saturate at LIMIT (since each COST < LIMIT)
    assert counter == LIMIT, f"counter={counter}, expected {LIMIT}"


async def test_blocking_lock_serializes_all_requests():
    """With BLOCKING locks, all N requests must eventually run (no fail-fast)."""
    backend = InMemoryLockBackend()
    counter = 0.0
    COST = 0.10
    N = 20

    async def spend(account_id: str):
        nonlocal counter
        lock = await backend.webhook_dedup(account_id)
        async with lock:
            await asyncio.sleep(0.001)
            counter += COST

    await asyncio.gather(*[spend("acc-A") for _ in range(N)])
    # Allow tiny float drift from asyncio.sleep scheduling
    assert abs(counter - N * COST) < 1e-9, f"counter={counter}, expected {N * COST}"


# ---------------------------------------------------------------------------
# Backend selection
# ---------------------------------------------------------------------------


def test_get_lock_backend_default_is_postgres(monkeypatch):
    monkeypatch.delenv("AKAROUTER_LOCK_BACKEND", raising=False)
    reset_lock_backend()
    backend = get_lock_backend()
    assert isinstance(backend, PostgresAdvisoryLockBackend)
    reset_lock_backend()


def test_get_lock_backend_memory_via_env(monkeypatch):
    monkeypatch.setenv("AKAROUTER_LOCK_BACKEND", "memory")
    reset_lock_backend()
    backend = get_lock_backend()
    assert isinstance(backend, InMemoryLockBackend)
    reset_lock_backend()


def test_reset_lock_backend_forces_re_read(monkeypatch):
    monkeypatch.setenv("AKAROUTER_LOCK_BACKEND", "memory")
    reset_lock_backend()
    backend1 = get_lock_backend()
    assert isinstance(backend1, InMemoryLockBackend)

    monkeypatch.setenv("AKAROUTER_LOCK_BACKEND", "postgres")
    reset_lock_backend()
    backend2 = get_lock_backend()
    assert isinstance(backend2, PostgresAdvisoryLockBackend)
    reset_lock_backend()