#!/usr/bin/env python3
"""
Add a new Hermes/Nous account to the pool.

Flow:
  1. Request device code from Nous portal
  2. Print URL + code for user to approve
  3. Poll for token
  4. Save to Supabase

Usage:
  python3 add-account.py [--account-label myemail@gmail.com]

Env:
  SUPABASE_URL=https://fleouqrgltkodumrgxlt.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from urllib.parse import urlencode

from urllib.request import Request, urlopen
from urllib.error import HTTPError

import requests

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://fleouqrgltkodumrgxlt.supabase.co")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_SERVICE_ROLE_KEY:
    sys.exit("SUPABASE_SERVICE_ROLE_KEY is required")

PROVIDER_NAME = "nous"
DEVICE_CODE_URL = "https://portal.nousresearch.com/api/oauth/device/code"
TOKEN_URL = "https://portal.nousresearch.com/api/oauth/token"
CLIENT_ID = "hermes-cli"
SCOPE = "inference:invoke"


def portal_post(path: str, form: dict, headers: dict | None = None) -> dict:
    url = f"https://portal.nousresearch.com{path}"
    data = urlencode(form).encode()
    req = Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    for k, v in (headers or {}).items():
        if k.lower() != "content-type":
            req.add_header(k, v)
    try:
        with urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {body}")


def device_login(label: str) -> dict:
    print("[+] Requesting device code...")
    code_resp = portal_post(
        "/api/oauth/device/code",
        {
            "client_id": CLIENT_ID,
            "scope": SCOPE,
        },
    )
    user_code = code_resp["user_code"]
    device_code = code_resp["device_code"]
    interval = int(code_resp.get("interval", 5))
    expires_in = int(code_resp.get("expires_in", 600))

    print()
    print("========================================")
    print(f"  Open: https://portal.nousresearch.com/manage-subscription?user_code={user_code}")
    print(f"  Code: {user_code}")
    print(f"  Timeout: {expires_in}s")
    print("========================================")
    print()

    # Poll
    deadline = time.time() + expires_in
    while time.time() < deadline:
        time.sleep(interval)
        try:
            token_resp = portal_post(
                "/api/oauth/token",
                {
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "device_code": device_code,
                    "client_id": CLIENT_ID,
                },
            )
        except RuntimeError as e:
            msg = str(e)
            if "authorization_pending" in msg or "slow_down" in msg:
                continue
            if "expired_token" in msg:
                sys.exit("Device code expired. Restart.")
            raise

        return token_resp

    sys.exit("Timed out waiting for approval")


def detect_supported_models(access_token: str) -> list[str]:
    """Try known free model IDs; return ones that don't get a 404/403."""
    base = "https://inference-api.nousresearch.com/v1"
    candidates = [
        "stepfun/step-3.7-flash:free",
        "nvidia/nemotron-3-ultra:free",
        "nvidia/nemotron-3-super-120b-a12b:free",
        "deepseek/deepseek-chat:free",
        "meta-llama/llama-3.3-70b-instruct:free",
        "openai/gpt-oss-20b:free",
        "openai/gpt-oss-120b:free",
        "qwen/qwen3-32b:free",
        "qwen/qwen3-235b-a22b:free",
    ]
    supported = []
    headers = {"Authorization": f"Bearer {access_token}"}
    for model in candidates:
        try:
            r = requests.post(
                f"{base}/chat/completions",
                headers=headers,
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": "hi"}],
                    "max_tokens": 1,
                },
                timeout=20,
            )
            if r.status_code == 200:
                supported.append(model)
            # 404/401/402 -> unsupported for this account
        except Exception:
            pass
    return supported or candidates[:2]  # fallback


def upsert_account(label: str, token_resp: dict, models: list[str]) -> None:
    provider_id = get_or_create_provider()
    access_token = token_resp["access_token"]
    refresh_token = token_resp.get("refresh_token")
    expires_in = int(token_resp.get("expires_in", 900))
    expires_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + expires_in - 120))

    # Upsert by access_token uniqueness? Here we just insert.
    payload = {
        "provider_id": str(provider_id),
        "account_label": label,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at,
        "models": models,
        "health_status": "healthy",
        "is_active": True,
    }

    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/accounts",
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        json=payload,
    )
    if r.status_code >= 300:
        sys.exit(f"Supabase insert failed: {r.status_code} {r.text[:200]}")
    print(f"[+] Account saved to Supabase ({label or 'unnamed'})")
    print(f"    Models detected: {models}")


def get_or_create_provider() -> str:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/providers?name=eq.{PROVIDER_NAME}&select=id",
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        },
    )
    if r.status_code == 200 and r.json():
        return r.json()[0]["id"]

    r2 = requests.post(
        f"{SUPABASE_URL}/rest/v1/providers",
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        json={
            "name": PROVIDER_NAME,
            "type": "hermes-nous",
            "base_url": "https://inference-api.nousresearch.com/v1",
            "device_code_url": DEVICE_CODE_URL,
            "token_url": TOKEN_URL,
            "config": {"client_id": CLIENT_ID, "scope": SCOPE, "token_refresh_skew_seconds": 120},
        },
    )
    if r2.status_code >= 300:
        sys.exit(f"Failed to create provider: {r2.status_code} {r2.text[:200]}")
    return r2.json()[0]["id"]


def refresh_access_token(refresh_token: str) -> dict:
    return portal_post(
        "/api/oauth/token",
        {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": CLIENT_ID,
        },
        headers={"x-nous-refresh-token": refresh_token},
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--account-label", default="")
    args = ap.parse_args()

    token_resp = device_login(args.account_label)
    print("[+] Login successful. Detecting supported models...")
    models = detect_supported_models(token_resp["access_token"])
    upsert_account(args.account_label, token_resp, models)
    print("[+] Done. Run server.py to use.")
