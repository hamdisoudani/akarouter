#!/usr/bin/env python3
"""
Standalone Nous Portal → OpenAI-compatible proxy.
- Runs OAuth device-code login if needed
- Auto-refreshes Nous access token before expiry
- Exposes OpenAI-compatible HTTP on port 8888
- Permits 2 free models: stepfun/step-3.7-flash:free  +  zai/GLM-5.1:US

Token storage: ~/.nous_tokens.json
"""

import json, os, sys, time, threading, http.server, json as _json
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from pathlib import Path

# =============================================================================
# Config
# =============================================================================

PORT = 8888
TOKEN_FILE = Path.home() / ".nous_tokens.json"

PORTAL_BASE = "https://portal.nousresearch.com"
INFERENCE_BASE = "https://inference-api.nousresearch.com/v1"
CLIENT_ID = "hermes-cli"
SCOPE = "inference:invoke"
REFRESH_SKEW = 120  # refresh 2 min before expiry

# Two free models you can switch between in OpenAI clients
ALLOWED_MODELS = [
    "stepfun/step-3.7-flash:free",
    "nvidia/nemotron-3-ultra:free",
]

# Backward-compat alias mapping if client sends old names
ALIAS_MAP = {
    "test-flash": "stepfun/step-3.7-flash:free",
    "step-3.7": "stepfun/step-3.7-flash:free",
    "nemotron": "nvidia/nemotron-3-ultra:free",
    "nemotron-3-ultra": "nvidia/nemotron-3-ultra:free",
    "glm-5.1": "zai/GLM-5.1:US",
}

# =============================================================================
# Token store
# =============================================================================

def load_tokens() -> dict:
    if TOKEN_FILE.exists():
        try:
            return json.loads(TOKEN_FILE.read_text())
        except Exception:
            pass
    return {}

def save_tokens(data: dict):
    TOKEN_FILE.write_text(json.dumps(data, indent=2))

# =============================================================================
# Nous Portal helpers
# =============================================================================

def portal_post(path: str, form: dict, headers: dict | None = None) -> dict:
    url = f"{PORTAL_BASE}{path}"
    encoded = _urlencode(form) if not (headers and headers.get("content-type","").endswith("json")) else json.dumps(form).encode()
    req = Request(url, data=encoded, method="POST")
    req.add_header("Content-Type", "application/json" if (headers and headers.get("content-type","").endswith("json")) else "application/x-www-form-urlencoded")
    for k, v in (headers or {}).items():
        if k.lower() != "content-type":
            req.add_header(k, v)
    with urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def _urlencode(data: dict) -> bytes:
    from urllib.parse import urlencode
    return urlencode(data).encode()

def request_device_code() -> dict:
    return portal_post("/api/oauth/device/code", {
        "client_id": CLIENT_ID,
        "scope": SCOPE,
    })

def poll_for_token(device_code: str, expires_in: int, interval: int = 1) -> dict:
    import time as _time
    deadline = _time.monotonic() + max(1, expires_in)
    while _time.monotonic() < deadline:
        try:
            payload = portal_post("/api/oauth/token", {
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "client_id": CLIENT_ID,
                "device_code": device_code,
            })
            if "access_token" in payload:
                return payload
        except HTTPError as e:
            body = json.loads(e.read())
            code = body.get("error", "")
            if code == "authorization_pending":
                _time.sleep(min(interval, 1))
                continue
            if code == "slow_down":
                interval = min(interval + 1, 30)
                _time.sleep(interval)
                continue
            raise RuntimeError(f"{code}: {body.get('error_description', '')}") from e
    raise TimeoutError("Device code expired before approval")

def refresh_access(refresh_token: str) -> dict:
    return portal_post("/api/oauth/token", {
        "grant_type": "refresh_token",
        "client_id": CLIENT_ID,
    }, headers={"x-nous-refresh-token": refresh_token})

# =============================================================================
# Token manager
# =============================================================================

class TokenManager:
    def __init__(self):
        self._lock = threading.Lock()
        self._tokens = load_tokens()

    def _now(self) -> float:
        return time.time()

    def _expires_at(self) -> float:
        try:
            return float(self._tokens.get("expires_at", 0))
        except Exception:
            return 0

    def get_access_token(self, force_refresh: bool = False) -> str:
        with self._lock:
            if not force_refresh and self._tokens.get("access_token") and (self._expires_at() - self._now()) > REFRESH_SKEW:
                return self._tokens["access_token"]

            rt = self._tokens.get("refresh_token")
            if not rt:
                raise RuntimeError("NO_TOKEN: no refresh token available; login required")

            payload = refresh_access(rt)
            new_rt = payload.get("refresh_token", rt)
            ttl = int(payload.get("expires_in", 900))
            now = time.time()
            self._tokens.update({
                "access_token": payload["access_token"],
                "refresh_token": new_rt,
                "obtained_at": now,
                "expires_at": now + ttl,
                "expires_in": ttl,
            })
            save_tokens(self._tokens)
            return self._tokens["access_token"]

    def needs_login(self) -> bool:
        return not self._tokens.get("refresh_token")

    def login(self) -> str:
        print("[ Nous Portal login ]\n")
        data = request_device_code()
        device_code = data["device_code"]
        user_code = data["user_code"]
        verification_uri = data.get("verification_uri_complete", data.get("verification_uri", ""))
        print(f"  1. Open: {verification_uri}")
        print(f"  2. Enter code: {user_code}\n")
        # Try to open browser
        try:
            import webbrowser
            webbrowser.open(verification_uri)
        except Exception:
            pass

        token_data = poll_for_token(device_code, int(data.get("expires_in", 600)), int(data.get("interval", 1)))

        now = time.time()
        ttl = int(token_data.get("expires_in", 900))
        self._tokens = {
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token", ""),
            "obtained_at": now,
            "expires_at": now + ttl,
            "expires_in": ttl,
            "inference_base_url": token_data.get("inference_base_url", INFERENCE_BASE),
            "scope": token_data.get("scope", SCOPE),
            "token_type": token_data.get("token_type", "Bearer"),
        }
        save_tokens(self._tokens)
        print("[+] Login successful.\n")
        return self._tokens["access_token"]

    def refresh_inference_url(self):
        if "inference_base_url" not in self._tokens:
            self._tokens["inference_base_url"] = INFERENCE_BASE
        return self._tokens["inference_base_url"]

# =============================================================================
# OpenAI-compatible proxy
# =============================================================================

class OpenAIProxy(http.server.BaseHTTPRequestHandler):
    manager: TokenManager = None  # class-level override set at startup

    def log_message(self, fmt, *args):
        sys.stdout.write(f"[proxy] {fmt % args}\n")

    def _json(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _err(self, status, msg):
        return self._json(status, {"error": {"message": msg, "type": "proxy_error"}})

    def _proxy_chat(self, token: str, body: dict):
        model = body.get("model", "")
        model = ALIAS_MAP.get(model, model)
        if model not in ALLOWED_MODELS:
            return self._err(400, f"model '{model}' not allowed. Allowed: {ALLOWED_MODELS}")

        payload = {
            "model": model,
            "messages": body.get("messages", []),
            "temperature": body.get("temperature", 0.7),
            "max_tokens": body.get("max_tokens", 1024),
            "stream": False,
        }
        # Pass through optional fields
        for key in ("stop", "top_p", "frequency_penalty", "presence_penalty", "seed"):
            if key in body:
                payload[key] = body[key]

        url = f"{INFERENCE_BASE}/chat/completions"
        req = Request(url, data=json.dumps(payload).encode(), method="POST")
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Content-Type", "application/json")
        with urlopen(req, timeout=120) as r:
            resp = json.loads(r.read())
        return resp

    def _proxy_models(self):
        return {
            "object": "list",
            "data": [
                {"id": m, "object": "model", "owned_by": "nousresearch", "api_key": "nous-proxy"}
                for m in ALLOWED_MODELS
            ],
        }

    def _handle(self):
        path = self.path.split("?")[0]
        try:
            if path in ("/v1/models", "/models"):
                return self._json(200, self._proxy_models())

            if path in ("/v1/chat/completions", "/chat/completions"):
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length)) if length else {}
                token = self.manager.get_access_token()
                resp = self._proxy_chat(token, body)
                return self._json(200, resp)

            if path in ("/health", "/"):
                return self._json(200, {"ok": True, "service": "nous-openai-proxy", "port": PORT, "models": ALLOWED_MODELS})

            return self._err(404, f"No route: {path}")
        except RuntimeError as e:
            msg = str(e)
            if msg.startswith("NO_TOKEN:"):
                return self._err(401, "Not authenticated. Run login flow first.")
            return self._err(500, msg)
        except HTTPError as e:
            try:
                err = json.loads(e.read())
            except Exception:
                err = {"error": {"message": str(e)}}
            return self._json(e.code, err)
        except Exception as e:
            return self._err(500, f"{type(e).__name__}: {e}")

    do_GET = _handle
    do_POST = _handle
    do_PUT = _handle
    do_DELETE = _handle

# =============================================================================
# Main
# =============================================================================

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Nous Portal → OpenAI proxy")
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--force-login", action="store_true", help="Trigger device-code login even if token exists")
    args = parser.parse_args()

    mgr = TokenManager()

    if args.force_login or mgr.needs_login():
        try:
            mgr.login()
        except Exception as e:
            print(f"Login failed: {e}", file=sys.stderr)
            sys.exit(1)

    # Warm up token / verify it works
    try:
        token = mgr.get_access_token()
        print(f"Access token OK. Expires in ~{int(mgr._expires_at() - mgr._now())}s")
    except Exception as e:
        print(f"Token error: {e}", file=sys.stderr)
        sys.exit(1)

    OpenAIProxy.manager = mgr

    server = http.server.HTTPServer(("0.0.0.0", args.port), OpenAIProxy)
    print(f"[+] Nous OpenAI proxy running on http://0.0.0.0:{args.port}")
    print(f"[+] Models: {ALLOWED_MODELS}")
    print(f"[+] Endpoints: /v1/chat/completions, /v1/models, /health")
    print(f"[+] Token file: {TOKEN_FILE}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.server_close()

if __name__ == "__main__":
    main()
