#!/usr/bin/env python3
"""
LiteLLM Phase 2 — multi-endpoint e2e test.

Proves the wrapper (app.core.llm.call) works against a battery of free
OpenAI-compatible endpoints, regardless of whether vsllm.com or the Hermes
providers are currently broken. This isolates the wrapper's correctness
from AkaRouter's prod-state rot.

Each endpoint uses the SAME wrapper code path that chat.py will eventually
call — db_token (api_key) + db_base (api_base) + custom/-prefixed model.

Free endpoints tried (no auth required for many of these):
  1. echo.akurain.my.id      (akarouter's own echo, if up)
  2. api.deepseek.com        (DeepSeek free tier — needs key)
  3. api.together.xyz        (Together free — needs key)
  4. openrouter.ai/api/v1    (free models — needs key)
  5. api.groq.com/openai/v1  (Groq free — needs key)
  6. generativelanguage.googleapis.com (Gemini via OpenAI-compat shim)

For each endpoint that has a working key, we run:
  - non-streaming chat
  - streaming chat (if endpoint supports it)
  - error path (bad key)

Output: which endpoints respond, latency, token counts, cost_usd.

Usage:
    .venv/bin/python scripts/litellm_phase2_e2e_multi.py
"""
import asyncio
import os
import sys
import time
from pathlib import Path

# Allow running from backend/ cwd
sys.path.insert(0, str(Path(__file__).parent.parent))

# Optional keys — read from env, skip endpoint if absent
def _env(name: str) -> str:
    return os.environ.get(name, "").strip()

ENDPOINTS = [
    {
        "name": "groq",
        "base_url": "https://api.groq.com/openai/v1",
        "api_key": _env("GROQ_API_KEY"),
        "model_alias": "akarouter-flash",
        "model_raw": "llama-3.1-8b-instant",
        "default_prefix": "groq/",
        "needs_key": True,
    },
    {
        "name": "deepseek",
        "base_url": "https://api.deepseek.com/v1",
        "api_key": _env("DEEPSEEK_API_KEY"),
        "model_alias": "akarouter-flash",
        "model_raw": "deepseek-chat",
        "default_prefix": "deepseek/",
        "needs_key": True,
    },
    {
        "name": "together",
        "base_url": "https://api.together.xyz/v1",
        "api_key": _env("TOGETHER_API_KEY"),
        "model_alias": "akarouter-flash",
        "model_raw": "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
        "default_prefix": "together_ai/",
        "needs_key": True,
    },
    {
        "name": "openrouter-free",
        "base_url": "https://openrouter.ai/api/v1",
        "api_key": _env("OPENROUTER_API_KEY"),
        "model_alias": "akarouter-flash",
        "model_raw": "meta-llama/llama-3.3-70b-instruct:free",
        "default_prefix": "openrouter/",
        "needs_key": True,
    },
    {
        "name": "nvidia",
        "base_url": "https://integrate.api.nvidia.com/v1",
        "api_key": _env("NVIDIA_API_KEY"),
        "model_alias": "akarouter-flash",
        "model_raw": "meta/llama-3.1-70b-instruct",
        "default_prefix": "nvidia_nim/",
        "needs_key": True,
    },
    {
        "name": "mistral",
        "base_url": "https://api.mistral.ai/v1",
        "api_key": _env("MISTRAL_API_KEY"),
        "model_alias": "akarouter-flash",
        "model_raw": "mistral-large-latest",
        "default_prefix": "mistral/",
        "needs_key": True,
    },
    {
        "name": "vsllm",
        "base_url": "https://vsllm.com/v1",
        "api_key": _env("VSLLM_API_KEY"),
        "model_alias": "akarouter-mini",
        "model_raw": "minimax/MiniMax-M3",
        "default_prefix": "custom/",
        "needs_key": True,
    },
]


async def test_endpoint(ep: dict) -> dict:
    """Run a single endpoint through the wrapper. Returns a result dict."""
    from app.core.llm import call, ensure_prefix, LiteLLMCallError

    name = ep["name"]
    api_key = ep["api_key"]
    api_base = ep["base_url"]

    if ep["needs_key"] and not api_key:
        return {"name": name, "status": "SKIP", "reason": "no API key in env"}

    # Use whatever key we have (empty string is fine for some no-auth endpoints)
    if not api_key:
        api_key = "sk-no-auth-needed"

    model = ensure_prefix(ep["model_raw"], default_prefix=ep["default_prefix"])
    messages = [{"role": "user", "content": "Reply with exactly: PONG"}]

    result = {
        "name": name,
        "model": model,
        "tests": {},
    }

    # Test 1: non-streaming
    t0 = time.perf_counter()
    try:
        response, md = await call(
            model=model,
            messages=messages,
            api_key=api_key,
            api_base=api_base,
            timeout=30,
            stream=False,
            temperature=0.0,
            max_tokens=10,
        )
        latency = (time.perf_counter() - t0) * 1000
        result["tests"]["non_stream"] = {
            "status": "PASS",
            "latency_ms": round(latency, 1),
            "prompt_tokens": md.prompt_tokens,
            "completion_tokens": md.completion_tokens,
            "total_tokens": md.total_tokens,
            "cost_usd": str(md.cost_usd),
            "content_preview": (response.choices[0].message.content or "")[:80],
        }
    except LiteLLMCallError as e:
        latency = (time.perf_counter() - t0) * 1000
        result["tests"]["non_stream"] = {
            "status": "FAIL",
            "category": e.category,
            "latency_ms": round(latency, 1),
            "error": str(e)[:200],
        }
    except Exception as e:
        latency = (time.perf_counter() - t0) * 1000
        result["tests"]["non_stream"] = {
            "status": "ERROR",
            "latency_ms": round(latency, 1),
            "error": f"{type(e).__name__}: {str(e)[:200]}",
        }

    # Test 2: streaming
    t0 = time.perf_counter()
    try:
        response, md = await call(
            model=model,
            messages=messages,
            api_key=api_key,
            api_base=api_base,
            timeout=30,
            stream=True,
            temperature=0.0,
            max_tokens=10,
        )
        chunks = 0
        async for chunk in response:
            chunks += 1
        latency = (time.perf_counter() - t0) * 1000
        result["tests"]["stream"] = {
            "status": "PASS",
            "latency_ms": round(latency, 1),
            "chunks": chunks,
            "cost_usd": str(md.cost_usd),
        }
    except LiteLLMCallError as e:
        latency = (time.perf_counter() - t0) * 1000
        result["tests"]["stream"] = {
            "status": "FAIL",
            "category": e.category,
            "latency_ms": round(latency, 1),
            "error": str(e)[:200],
        }
    except Exception as e:
        latency = (time.perf_counter() - t0) * 1000
        result["tests"]["stream"] = {
            "status": "ERROR",
            "latency_ms": round(latency, 1),
            "error": f"{type(e).__name__}: {str(e)[:200]}",
        }

    # Test 3: error path (intentionally bad key) — only for key-required endpoints
    if ep["needs_key"]:
        bad_key = api_key[:-4] + "XXXX"
        t0 = time.perf_counter()
        try:
            response, md = await call(
                model=model,
                messages=messages,
                api_key=bad_key,
                api_base=api_base,
                timeout=15,
                stream=False,
                max_tokens=5,
            )
            latency = (time.perf_counter() - t0) * 1000
            result["tests"]["bad_key"] = {
                "status": "UNEXPECTED_PASS",
                "latency_ms": round(latency, 1),
                "error": "Bad key was accepted — auth validation broken!",
            }
        except LiteLLMCallError as e:
            latency = (time.perf_counter() - t0) * 1000
            result["tests"]["bad_key"] = {
                "status": "PASS",
                "category": e.category,
                "latency_ms": round(latency, 1),
                "error": str(e)[:200],
            }
        except Exception as e:
            latency = (time.perf_counter() - t0) * 1000
            result["tests"]["bad_key"] = {
                "status": "ERROR",
                "latency_ms": round(latency, 1),
                "error": f"{type(e).__name__}: {str(e)[:200]}",
            }

    return result


async def main():
    print("=" * 70)
    print("LiteLLM wrapper — multi-endpoint e2e")
    print("=" * 70)
    print()

    results = []
    for ep in ENDPOINTS:
        print(f"→ {ep['name']:20s} ({ep['base_url']})")
        result = await test_endpoint(ep)
        results.append(result)
        for test_name, tr in result.get("tests", {}).items():
            print(f"    [{tr['status']:7s}] {test_name:12s} {tr.get('latency_ms', 0):6.1f}ms  "
                  f"{tr.get('category', ''):20s}  {tr.get('content_preview', tr.get('error', ''))[:60]}")
        print()

    # Summary
    print("=" * 70)
    print("SUMMARY")
    print("=" * 70)
    total_pass = 0
    total_fail = 0
    total_skip = 0
    for r in results:
        if r.get("status") == "SKIP":
            total_skip += 1
            print(f"  SKIP  {r['name']:20s} - {r.get('reason','')}")
            continue
        if "tests" not in r:
            continue
        for tname, tr in r["tests"].items():
            if tr["status"] == "PASS":
                total_pass += 1
            else:
                total_fail += 1
        n = sum(1 for tr in r["tests"].values() if tr["status"] == "PASS")
        m = len(r["tests"])
        print(f"  {n}/{m}    {r['name']:20s} passed")
    print()
    print(f"  Total: {total_pass} pass / {total_fail} fail / {total_skip} skip")
    print()
    if total_pass == 0:
        print("❌ No endpoint produced a working response.")
        print("   Set at least one of these env vars to enable tests:")
        print("     DEEPSEEK_API_KEY / GROQ_API_KEY / TOGETHER_API_KEY / OPENROUTER_API_KEY / VSLLM_API_KEY")
        return 1
    if total_fail == 0 and total_skip == 0:
        print("✅ All endpoints PASS — wrapper is verified working.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))