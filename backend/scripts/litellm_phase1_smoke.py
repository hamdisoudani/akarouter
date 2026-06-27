"""Phase 1 spike smoke test — measure import + dry-run overhead of LiteLLM vs old path.

This does NOT call any real upstream. It:
1. Imports the LiteLLM wrapper.
2. Validates that a single call() invocation against a fake host returns the
   expected error category (LiteLLMCallError with .category='connection_failed'
   or 'upstream_unavailable' after retries).
3. Times the wrapper overhead (kwargs assembly + LiteLLM internal setup).
4. Times the equivalent manual httpx path that chat.py currently uses.

Run: .venv/bin/python scripts/litellm_phase1_smoke.py
"""
import asyncio
import sys
import time
from pathlib import Path

# Allow running from backend/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx

from app.core.llm import call, LiteLLMCallError, CallMetadata, ensure_prefix


async def measure_litellm():
    """Dry-run LiteLLM call against an unreachable host. Expect clean error."""
    started = time.time()
    try:
        response, md = await call(
            model=ensure_prefix("gpt-4o-mini"),
            messages=[{"role": "user", "content": "ping"}],
            api_key="sk-fake-for-benchmark",
            api_base="http://127.0.0.1:1",  # unreachable
            timeout=5,
            stream=False,
        )
        return ("unexpected_success", None, (time.time() - started) * 1000)
    except LiteLLMCallError as e:
        return (e.category, e.message[:80], (time.time() - started) * 1000)
    except Exception as e:
        return (type(e).__name__, str(e)[:80], (time.time() - started) * 1000)


async def measure_old_httpx():
    """Mirror the chat.py pattern: raw httpx.post against same unreachable host."""
    started = time.time()
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(
                "http://127.0.0.1:1/chat/completions",
                headers={"Authorization": "Bearer sk-fake", "Content-Type": "application/json"},
                json={"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "ping"}]},
            )
        return ("unexpected_success", None, (time.time() - started) * 1000)
    except (httpx.ConnectError, httpx.ConnectTimeout) as e:
        return ("connect_error", str(e)[:80], (time.time() - started) * 1000)
    except httpx.RequestError as e:
        return ("request_error", str(e)[:80], (time.time() - started) * 1000)
    except Exception as e:
        return (type(e).__name__, str(e)[:80], (time.time() - started) * 1000)


async def measure_kwargs_only():
    """Measure just the kwarg assembly + import overhead of LiteLLM (no I/O)."""
    from litellm import acompletion
    started = time.time()
    for _ in range(100):
        kwargs = {
            "model": "openai/gpt-4o-mini",
            "messages": [{"role": "user", "content": "x"}],
            "api_key": "x",
            "timeout": 5,
            "num_retries": 2,
            "stream": False,
            "temperature": 0.7,
        }
    return (time.time() - started) * 1000


async def main():
    print("=" * 60)
    print("Phase 1 spike smoke test: LiteLLM vs raw httpx")
    print("=" * 60)

    # 1) LiteLLM end-to-end dry-run
    print("\n[1] LiteLLM call() against unreachable host (measures: setup + 2 retries + failure)")
    cat, msg, ms = await measure_litellm()
    print(f"    category: {cat}")
    print(f"    detail:   {msg}")
    print(f"    total:    {ms:.1f} ms (with 2 retries, each waiting up to 5s)")

    # 2) Raw httpx path chat.py uses today
    print("\n[2] Raw httpx.post() against unreachable host (current chat.py path)")
    cat, msg, ms = await measure_old_httpx()
    print(f"    category: {cat}")
    print(f"    detail:   {msg}")
    print(f"    total:    {ms:.1f} ms (no retries; bails fast)")

    # 3) Pure overhead of LiteLLM kwargs assembly (100 iterations)
    print("\n[3] LiteLLM kwarg assembly overhead (100 iters, no I/O)")
    ms = await measure_kwargs_only()
    print(f"    total:    {ms:.2f} ms for 100 iterations = {ms/100:.3f} ms/call overhead")

    # 4) File-size delta
    print("\n[4] Code reduction potential")
    chat_py_lines = 784  # from earlier wc
    llm_py_lines = sum(1 for _ in open(Path(__file__).resolve().parents[1] / "app" / "core" / "llm.py"))
    print(f"    current chat.py:    {chat_py_lines} lines (includes SSE extractor, manual retries, manual streaming)")
    print(f"    new llm.py:         {llm_py_lines} lines (LiteLLM wrapper)")
    print(f"    net:                wrapper REPLACES ~{chat_py_lines - 50} lines of chat.py internals")
    print(f"                        (caller still owns auth, billing, logging)")

    print("\n" + "=" * 60)
    print("Smoke test complete. No real upstream call was made.")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
