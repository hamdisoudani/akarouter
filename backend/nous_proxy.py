#!/usr/bin/env python3
"""Local reverse proxy for Nous Inference API.
Reads JWT token from Hermes agent's auth.json — Hermes handles refresh automatically.
OpenClaw points to this as baseUrl with any dummy apiKey."""

import json, os, sys, time, urllib.request, urllib.error, http.server, threading

HERMES_AUTH_FILE = "/home/ubuntu/.hermes/auth.json"
UPSTREAM = "https://inference-api.nousresearch.com"
PORT = 18888

# Cache token to avoid reading file on every single request
_cached_token = None
_cached_token_ts = 0
TOKEN_CACHE_TTL = 60  # re-read from disk every 60s max

def get_access_token():
    """Read access token from Hermes auth.json (cached for up to 60s)."""
    global _cached_token, _cached_token_ts
    now = time.time()
    if _cached_token and (now - _cached_token_ts) < TOKEN_CACHE_TTL:
        return _cached_token
    try:
        with open(HERMES_AUTH_FILE) as f:
            data = json.load(f)
        token = data.get("providers", {}).get("nous", {}).get("access_token", "")
        if token:
            _cached_token = token
            _cached_token_ts = now
            return token
    except Exception as e:
        print(f"Warning: Failed to read Hermes auth: {e}", file=sys.stderr)
    # Fallback: try old token.json
    try:
        old_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "token.json")
        with open(old_file) as f:
            data = json.load(f)
        token = data.get("access_token", "")
        if token:
            _cached_token = token
            _cached_token_ts = now
            return token
    except Exception:
        pass
    raise RuntimeError("No valid Nous token found in Hermes auth.json or fallback token.json")


class NousProxyHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self._proxy("GET")

    def do_POST(self):
        self._proxy("POST")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _proxy(self, method):
        try:
            token = get_access_token()
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length > 0 else None

            # Auto-rewrite model IDs
            if body:
                body = body.replace(b'"test-flash"', b'"stepfun/step-3.7-flash:free"')
                if b'"stepfun/step-3.7-flash"' in body and b':free' not in body:
                    body = body.replace(b'"stepfun/step-3.7-flash"', b'"stepfun/step-3.7-flash:free"')
                # Default reasoning_effort to "high" if missing and model is stepfun
                if b'stepfun' in body and b'reasoning_effort' not in body:
                    if b'max_tokens' in body:
                        body = body.replace(b'"max_tokens"', b'"reasoning_effort": "high", "max_tokens"')
                    else:
                        body = body.rstrip().rstrip(b'}') + b', "reasoning_effort": "high"}'

            upstream_url = f"{UPSTREAM}{self.path}"
            req = urllib.request.Request(upstream_url, data=body, method=method)
            req.add_header("Authorization", f"Bearer {token}")
            req.add_header("Content-Type", self.headers.get("Content-Type", "application/json"))

            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    self.send_response(resp.status)
                    for key, val in resp.getheaders():
                        if key.lower() not in ("transfer-encoding", "connection"):
                            self.send_header(key, val)
                    self.end_headers()
                    self.wfile.write(resp.read())
            except urllib.error.HTTPError as e:
                self.send_response(e.code)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(e.read())
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def log_message(self, format, *args):
        pass  # silent


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    server = http.server.HTTPServer(("127.0.0.1", port), NousProxyHandler)
    print(f"Nous proxy listening on http://127.0.0.1:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
