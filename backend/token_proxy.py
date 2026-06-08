#!/usr/bin/env python3
"""Tiny HTTP server that returns the current valid Nous access token.
OpenClaw calls this as a custom provider with the token as the API key."""
from http.server import HTTPServer, BaseHTTPRequestHandler
import json, os, sys, subprocess

class TokenHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/token":
            try:
                result = subprocess.run(
                    [sys.executable, os.path.join(os.path.dirname(__file__), "refresh_token.py")],
                    capture_output=True, text=True, timeout=30
                )
                token = result.stdout.strip().split('\n')[-1]  # last line is the token
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(token.encode())
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(f"Error: {e}".encode())
        else:
            self.send_response(404)
            self.end_headers()
    
    def log_message(self, format, *args):
        pass  # silent

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 18888
    server = HTTPServer(("127.0.0.1", port), TokenHandler)
    print(f"Token proxy on http://127.0.0.1:{port}/token", flush=True)
    server.serve_forever()
