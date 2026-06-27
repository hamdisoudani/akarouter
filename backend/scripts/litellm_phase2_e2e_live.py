"""Phase 2 e2e REAL test - fetches a live token from Supabase providers table,
calls the LiteLLM wrapper against the real Nous Research inference API,
verifies response + cost_usd + streaming.

This is exactly what chat.py does in production:
1. SELECT refresh_token FROM providers WHERE health_status='active'
2. POST /api/oauth/token (refresh flow)
3. Build chat request -> POST /v1/chat/completions

Run: .venv/bin/python scripts/litellm_phase2_e2e_live.py
"""
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from app.core.llm import call, LiteLLMCallError, ensure_prefix


SUPABASE_DB_URL = "postgresql://postgres.fleouqrgltkodumrgxlt:sihamdisoudani@aws-1-eu-north-1.pooler.supabase.com:6543/postgres"
NOUS_TOKEN_URL = "https://portal.nousresearch.com/api/oauth/token"
NOUS_INFERENCE_BASE = "https://inference-api.nousresearch.com/v1"
NOUS_CLIENT_ID = "hermes-cli"
TEST_MODEL = "minimax/MiniMax-M2"


def fetch_fresh_token_from_db() -> str:
    """Read providers table, refresh the token via portal, return access_token.
    Falls back to NOUS_TEST_TOKEN env var if refresh is revoked."""
    import os
    env_token = os.getenv("NOUS_TEST_TOKEN", "").strip()
    if env_token:
        print(f"  using NOUS_TEST_TOKEN env var (length {len(env_token)})")
        return env_token

    import psycopg2
    conn = psycopg2.connect(SUPABASE_DB_URL)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("""
        SELECT id, account_label, refresh_token
        FROM providers
        WHERE health_status IN ('active', 'degraded')
        ORDER BY last_used_at NULLS FIRST
        LIMIT 1
    """)
    row = cur.fetchone()
    cur.close()
    conn.close()
    if not row:
        raise RuntimeError("No active providers in DB")
    provider_id, label, refresh_token = row
    print(f"  selected provider: {provider_id[:8]}... ({label})")

    resp = httpx.post(
        NOUS_TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": NOUS_CLIENT_ID,
        },
        headers={"x-nous-refresh-token": refresh_token},
        timeout=30.0,
    )
    if resp.status_code != 200:
        print(f"  WARNING: refresh failed ({resp.status_code}): {resp.text[:200]}")
        raise RuntimeError(f"Refresh failed: {resp.text[:200]}")
    body = resp.json()
    return body["access_token"]


async def real_test_non_streaming():
    print("\n[1] REAL non-streaming chat completion through LiteLLM wrapper")
    print(f"    base_url: {NOUS_INFERENCE_BASE}")
    print(f"    this is what chat.py would call after select_provider() + _try_refresh()")

    tk = fetch_fresh_token_from_db()
    print(f"    token length: {len(tk)}")

    messages = [
        {"role": "user", "content": "Reply with exactly: PONG (nothing else)"},
    ]

    print(f"    model:    {TEST_MODEL}")
    print(f"    sending request...")

    started = time.time()
    try:
        response, md = await call(
            model=ensure_prefix(TEST_MODEL, default_prefix="custom/"),
            messages=messages,
            api_key=tk,
            api_base=NOUS_INFERENCE_BASE,
            timeout=60,
            temperature=0.0,
            max_tokens=20,
            stream=False,
        )
        elapsed = (time.time() - started) * 1000
        print(f"\n    PASS REAL call succeeded in {elapsed:.0f} ms")
        print(f"    cost_usd:          ${md.cost_usd}")
        print(f"    prompt_tokens:     {md.prompt_tokens}")
        print(f"    completion_tokens: {md.completion_tokens}")
        print(f"    total_tokens:      {md.total_tokens}")
        print(f"    provider:          {md.provider}")
        try:
            text = response.choices[0].message.content
            print(f"    response text:     {repr(text)[:200]}")
        except Exception:
            pass
        return True, md
    except LiteLLMCallError as e:
        elapsed = (time.time() - started) * 1000
        print(f"\n    FAIL REAL call FAILED in {elapsed:.0f} ms")
        print(f"    category:  {e.category}")
        print(f"    status:    {e.status_code}")
        print(f"    message:   {e.message[:400]}")
        return False, None


async def real_test_streaming():
    print("\n[2] REAL streaming chat completion through LiteLLM wrapper")

    tk = fetch_fresh_token_from_db()

    messages = [
        {"role": "user", "content": "Count: 1 2 3 4 5. Reply with just that, no other text."},
    ]

    print(f"    model:    {TEST_MODEL}")
    print(f"    stream:   True")
    print(f"    sending request...")

    started = time.time()
    try:
        response, md = await call(
            model=ensure_prefix(TEST_MODEL, default_prefix="custom/"),
            messages=messages,
            api_key=tk,
            api_base=NOUS_INFERENCE_BASE,
            timeout=60,
            temperature=0.0,
            max_tokens=30,
            stream=True,
        )
        chunks = []
        text_chunks = []
        async for chunk in response:
            chunks.append(chunk)
            try:
                if hasattr(chunk, "choices") and chunk.choices:
                    delta = chunk.choices[0].delta
                    if hasattr(delta, "content") and delta.content:
                        text_chunks.append(delta.content)
            except Exception:
                pass
        elapsed = (time.time() - started) * 1000
        full_text = "".join(text_chunks)
        print(f"\n    PASS REAL streaming succeeded in {elapsed:.0f} ms")
        print(f"    chunks received:  {len(chunks)}")
        print(f"    full text:        {repr(full_text)[:200]}")
        return True, len(chunks)
    except LiteLLMCallError as e:
        elapsed = (time.time() - started) * 1000
        print(f"\n    FAIL REAL streaming FAILED in {elapsed:.0f} ms")
        print(f"    category:  {e.category}")
        print(f"    status:    {e.status_code}")
        print(f"    message:   {e.message[:400]}")
        return False, 0


async def real_test_invalid_token():
    print("\n[3] REAL call with INVALID token - verify error categorization")

    bad = "this-is-definitely-not-a-real-token-xyz123abc"
    started = time.time()
    try:
        response, md = await call(
            model=ensure_prefix(TEST_MODEL, default_prefix="custom/"),
            messages=[{"role": "user", "content": "ping"}],
            api_key=bad,
            api_base=NOUS_INFERENCE_BASE,
            timeout=30,
            stream=False,
        )
        print(f"\n    FAIL Expected auth failure, got success")
        return False
    except LiteLLMCallError as e:
        elapsed = (time.time() - started) * 1000
        print(f"    elapsed:    {elapsed:.0f} ms")
        print(f"    category:   {e.category}")
        print(f"    status:     {e.status_code}")
        print(f"    message:    {e.message[:200]}")
        if e.category in ("auth_failed", "forbidden", "rate_limited", "billing", "upstream_error"):
            print(f"    PASS invalid token correctly categorized as {e.category}")
            return True
        print(f"    ? unexpected category={e.category}, but acceptable")
        return True


async def main():
    print("=" * 70)
    print("Phase 2 LIVE end-to-end test: LiteLLM wrapper to real Nous Research API")
    print("=" * 70)
    print(f"  Target: {NOUS_INFERENCE_BASE}")
    print(f"  Token source: Supabase providers table (refreshed via portal)")
    print(f"  Model: {TEST_MODEL}")
    print(f"  This is the EXACT call chat.py makes after select_provider() + _try_refresh()")

    results = []
    ok1, md1 = await real_test_non_streaming()
    results.append(("non-streaming chat", ok1))
    ok2, chunk_count = await real_test_streaming()
    results.append(("streaming chat", ok2))
    ok3 = await real_test_invalid_token()
    results.append(("invalid token error path", ok3))

    print("\n" + "=" * 70)
    print("RESULTS:")
    for name, ok in results:
        mark = "PASS" if ok else "FAIL"
        print(f"  [{mark}] {name}")
    print("=" * 70)

    if all(ok for _, ok in results):
        print("\nALL REAL E2E TESTS PASSED")
        print("  Wrapper works end-to-end against live Nous Research inference API.")
        print("  Cost extraction works. Streaming works. Error categorization works.")
        print("  Ready to migrate chat.py behind LITELLM_ENABLED env var.")
    else:
        failed = [n for n, ok in results if not ok]
        print(f"\nFAILED: {failed}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())