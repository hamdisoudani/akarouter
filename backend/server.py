#!/usr/bin/env python3
"""
Production multi-account Nous/Hermes OpenAI-compatible proxy.

- Reads / writes accounts via Supabase REST API
- Round-robin + health-weighted routing
- Per-request auto-refresh with in-flight lock via DB row
- Logs all requests to Supabase
- Exposes OpenAI-compatible API on port 8888

No external Python deps beyond stdlib + requests (used only for Supabase REST).
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
# Branded model aliases for AKAROUTER
BRANDED_MODELS = {
    "akarouter": "stepfun/step-3.7-flash:free",
    "akarouter-pro": "stepfun/step-3.7-flash:free",
}

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://fleouqrgltkodumrgxlt.supabase.co").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_DB_URL = os.getenv(
    "SUPABASE_DB_URL",
    "postgresql://postgres.fleouqrgltkodumrgxlt:sihamdisoudani@aws-1-eu-north-1.pooler.supabase.com:6543/postgres",
)

PORT = int(os.getenv("PORT", "8888"))
PROVIDER_NAME = "nous"
API_BASE = "https://inference-api.nousresearch.com/v1"
DEVICE_CODE_URL = "https://portal.nousresearch.com/api/oauth/device/code"
TOKEN_URL = "https://portal.nousresearch.com/api/oauth/token"
CLIENT_ID = "hermes-cli"
SCOPE = "inference:invoke"
MAX_CONCURRENT_PER_ACCOUNT = 12
TOKEN_REFRESH_SKEW = int(os.getenv("TOKEN_REFRESH_SKEW", "120"))
REFRESH_LOCK_TTL = 30  # seconds before we consider a refresh lock stale


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------
class SupabaseClient:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.key = key
        self.headers_base = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }

    def get(self, path: str, params: str = "", headers: dict | None = None) -> list[dict]:
        url = f"{self.url}/rest/v1/{path}"
        if params:
            url = f"{url}?{params}"
        r = requests.get(url, headers=self._merge(headers), timeout=15)
        r.raise_for_status()
        return r.json() if r.text.strip() else []

    def post(self, path: str, payload: dict, headers: dict | None = None) -> dict:
        r = requests.post(
            f"{self.url}/rest/v1/{path}",
            headers=self._merge({**self.headers_base, "Prefer": "return=representation"}, headers),
            json=payload,
            timeout=15,
        )
        if r.status_code >= 300:
            raise RuntimeError(f"Supabase POST {path} failed: {r.status_code} {r.text[:300]}")
        data = r.json()
        return data[0] if isinstance(data, list) and data else data

    def patch(self, path: str, payload: dict, headers: dict | None = None) -> dict:
        r = requests.patch(
            f"{self.url}/rest/v1/{path}",
            headers=self._merge({**self.headers_base, "Prefer": "return=representation"}, headers),
            json=payload,
            timeout=15,
        )
        if r.status_code >= 300:
            raise RuntimeError(f"Supabase PATCH {path} failed: {r.status_code} {r.text[:300]}")
        data = r.json()
        return data[0] if isinstance(data, list) and data else data

    def _merge(self, base: dict, extra: dict | None) -> dict:
        h = dict(base)
        if extra:
            h.update(extra)
        return h


db = SupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


# ---------------------------------------------------------------------------
# Provider / token helpers
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Account model
# ---------------------------------------------------------------------------
class Account:
    def __init__(self, row: dict):
        self.id: str = row["id"]
        self.account_label: str | None = row.get("account_label")
        self.access_token: str = row.get("access_token") or ""
        self.refresh_token: str | None = row.get("refresh_token")
        self.expires_at: str | None = row.get("expires_at")
        self.models: list[str] = row.get("models") or []
        self.weight: float = float(row.get("weight") or 1.0)
        self.is_active: bool = bool(row.get("is_active", True))
        self.health_status: str = row.get("health_status") or "unknown"
        self.total_requests: int = int(row.get("total_requests") or 0)
        self.total_errors: int = int(row.get("total_errors") or 0)
        self.in_flight: int = int(row.get("in_flight") or 0)
        self.refresh_lock_at: str | None = row.get("refresh_lock_at")

    def expired(self) -> bool:
        if not self.expires_at:
            return True
        try:
            exp = time.mktime(time.strptime(self.expires_at[:19], "%Y-%m-%dT%H:%M:%S"))
            return time.time() > (exp - TOKEN_REFRESH_SKEW)
        except Exception:
            return True

    def success_rate(self) -> float:
        total = self.total_requests
        if total <= 0:
            return 1.0
        return max(0.0, 1.0 - (self.total_errors / total))

    def score(self) -> float:
        if not self.is_active or self.health_status == "dead":
            return 0.0
        concurrency_penalty = min(1.0, self.in_flight / MAX_CONCURRENT_PER_ACCOUNT)
        return self.weight * self.success_rate() * (1.0 - concurrency_penalty)


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
class Router:
    def __init__(self):
        self.accounts: list[Account] = []

    def load_accounts(self):
        sql = (
            "select=*&"
            f"provider_id=eq.(select id from providers where name=eq.{PROVIDER_NAME})&"
            "is_active=eq.true"
        )
        rows = db.get("accounts", sql)
        self.accounts = [Account(r) for r in rows]
        print(f"[router] Loaded {len(self.accounts)} active accounts")

    def pick(self, model: str) -> Account | None:
        candidates = [a for a in self.accounts if model in a.models]
        if not candidates:
            return None
        candidates.sort(key=lambda a: a.score(), reverse=True)
        return candidates[0]

    def mark_used(self, account: Account, latency_ms: int, ok: bool):
        account.in_flight = max(0, account.in_flight - 1)
        account.total_requests += 1
        if not ok:
            account.total_errors += 1
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        payload = {
            "last_used_at": now_iso,
            "total_requests": account.total_requests,
            "total_errors": account.total_errors,
            "health_status": "healthy" if ok else "degraded",
            "in_flight": account.in_flight,
        }
        if not ok:
            payload["last_error"] = "request_failed"
        try:
            db.patch(f"accounts?id=eq.{account.id}", payload)
        except Exception as e:
            print(f"[router] Failed to update account {account.id}: {e}")

    def refresh_and_update(self, account: Account, token_resp: dict):
        account.access_token = token_resp["access_token"]
        account.refresh_token = token_resp.get("refresh_token", account.refresh_token)
        exp = int(token_resp.get("expires_in", 900))
        account.expires_at = time.strftime(
            "%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + exp - TOKEN_REFRESH_SKEW)
        )
        db.patch(
            f"accounts?id=eq.{account.id}",
            {
                "access_token": account.access_token,
                "refresh_token": account.refresh_token,
                "expires_at": account.expires_at,
                "refresh_lock_at": None,
            },
        )


router = Router()


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------
class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stdout.write(f"[{time.strftime('%H:%M:%S')}] " + fmt % args + "\n")
        sys.stdout.flush()

    def _send(self, status: int, obj: dict):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def _err(self, status: int, message: str, typ: str = "proxy_error"):
        self._send(status, {"error": {"message": message, "type": typ}})

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if not length:
            return {}
        return json.loads(self.rfile.read(length))

    def _try_refresh(self, account: Account) -> bool:
        """Refresh token with DB-level lock to prevent races."""
        if not account.refresh_token:
            return False
        now = time.time()
        # If another refresh was recently started, wait and recheck
        if account.refresh_lock_at:
            try:
                lock_ts = time.mktime(time.strptime(account.refresh_lock_at[:19], "%Y-%m-%dT%H:%M:%S"))
                if (now - lock_ts) < REFRESH_LOCK_TTL:
                    # Another refresh in progress — briefly wait then recheck expiry
                    time.sleep(1)
                    if not account.expired():
                        return True
                else:
                    # Stale lock, clear it
                    try:
                        db.patch(f"accounts?id=eq.{account.id}", {"refresh_lock_at": None})
                    except Exception:
                        pass
            except Exception:
                pass

        # Set lock
        try:
            db.patch(f"accounts?id=eq.{account.id}", {"refresh_lock_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
        except Exception:
            pass

        try:
            token_resp = refresh_access_token(account.refresh_token)
            router.refresh_and_update(account, token_resp)
            return True
        except Exception as e:
            # Clear lock on failure so next attempt can try
            try:
                db.patch(f"accounts?id=eq.{account.id}", {"refresh_lock_at": None})
            except Exception:
                pass
            print(f"[refresh] Failed for {account.id}: {e}")
            return False
        finally:
            # Always clear our lock
            try:
                db.patch(f"accounts?id=eq.{account.id}", {"refresh_lock_at": None})
            except Exception:
                pass

    def _proxy_chat(self, req: dict):
        requested_model = req.get("model")
        if not requested_model:
            return self._err(400, "Missing 'model' in request body")

        model = BRANDED_MODELS.get(requested_model, requested_model)
        if model != requested_model:
            req["model"] = model

        account = router.pick(model)
        if account is None:
            return self._err(400, f"No account available for model '{requested_model}'")

        # Refresh token if needed
        if account.expired():
            ok = self._try_refresh(account)
            if not ok:
                return self._err(502, "Token refresh failed for selected account")

        account.in_flight += 1
        t0 = time.time()

        try:
            r = requests.post(
                f"{API_BASE}/chat/completions",
                headers={
                    "Authorization": f"Bearer {account.access_token}",
                    "Content-Type": "application/json",
                },
                json=req,
                timeout=120,
                stream=False,
            )
        except Exception as e:
            router.mark_used(account, 0, False)
            return self._err(502, f"Upstream error: {e}")

        latency_ms = int((time.time() - t0) * 1000)
        ok = r.status_code == 200
        router.mark_used(account, latency_ms, ok)

        # Async log (fire and forget)
        try:
            db.post(
                "request_logs",
                {
                    "account_id": account.id,
                    "request_id": str(uuid.uuid4()),
                    "model": model,
                    "status": "success" if ok else "error",
                    "http_status": r.status_code,
                    "latency_ms": latency_ms,
                    "error_message": r.text[:500] if not ok else None,
                },
            )
        except Exception:
            pass

        if not ok:
            try:
                err_body = r.json()
            except ValueError:
                err_body = {"error": {"message": r.text[:200]}}
            return self._send(r.status_code, err_body)

        try:
            upstream = r.json()
        except ValueError:
            return self._err(502, "Invalid JSON from upstream")

        # Normalize
        upstream.setdefault("id", f"proxy-{uuid.uuid4().hex}")
        if "model" in upstream and isinstance(upstream["model"], str):
            upstream["model"] = model
        return self._send(200, upstream)

    def _list_models(self):
        raw = sorted({m for a in router.accounts for m in a.models})
        # Map back to branded names where possible
        rev = {v: k for k, v in BRANDED_MODELS.items()}
        branded = sorted({rev.get(m, m) for m in raw})
        self._send(200, {"object": "list", "data": [{"id": m, "object": "model"} for m in branded]})


    def _health(self):
        rows = db.get(
            "accounts",
            "select=id,account_label,health_status,weight,total_requests,total_errors,in_flight,last_used_at",
        )
        self._send(
            200,
            {
                "ok": True,
                "accounts": len(rows),
                "provider": PROVIDER_NAME,
                "details": rows,
            },
        )

    def do_GET(self):
        if self.path.startswith("/health"):
            return self._health()
        if self.path.startswith("/v1/models"):
            return self._list_models()
        return self._err(404, "Not found")

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        try:
            body = json.loads(self.rfile.read(length)) if length else {}
        except ValueError:
            return self._err(400, "Invalid JSON body")
        if self.path.startswith("/v1/chat/completions"):
            return self._proxy_chat(body)
        return self._err(404, "Not found")

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
def main():
    if not SUPABASE_SERVICE_ROLE_KEY:
        print("[!] SUPABASE_SERVICE_ROLE_KEY is required")
        sys.exit(1)

    print("[+] Connecting to Supabase...")
    router.load_accounts()

    server = HTTPServer(("0.0.0.0", PORT), ProxyHandler)
    print(f"[+] Multi-account Nous proxy listening on :{PORT}")
    print(f"    POST /v1/chat/completions")
    print(f"    GET  /v1/models")
    print(f"    GET  /health")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[+] Shutting down...")
        server.server_close()


if __name__ == "__main__":
    main()
