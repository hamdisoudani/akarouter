#!/usr/bin/env python3
"""Refresh Nous OAuth token. Only saves to local token.json — does NOT touch openclaw.json.
The nous_proxy.py reads from token.json on every request."""
import json, os, sys, time, argparse, uuid, urllib.request, urllib.error

AUTH_DIR = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(AUTH_DIR, "token.json")
PORTAL_URL = "https://portal.nousresearch.com"
CLIENT_ID = "hermes-cli"

def device_code_url():
    code = str(uuid.uuid4()).replace('-','')[:16]
    return f"https://portal.nousresearch.com/oauth/authorize?client_id={CLIENT_ID}&response_type=device_code&scope=openid offline_access&device_code={code}"

def load_token():
    with open(TOKEN_FILE) as f:
        return json.load(f)

def save_token(data):
    data["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
    with open(TOKEN_FILE, "w") as f:
        json.dump(data, f, indent=2)
    os.chmod(TOKEN_FILE, 0o600)

def refresh(refresh_token):
    url = f"{PORTAL_URL}/api/oauth/token"
    body = f"grant_type=refresh_token&client_id={CLIENT_ID}".encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    req.add_header("x-nous-refresh-token", refresh_token)
    with urllib.request.urlopen(req, timeout=20) as resp:
        result = json.loads(resp.read().decode())
        if "access_token" not in result:
            raise ValueError("No access_token in response")
        return result

def main():
    data = load_token()
    refresh_tok = data.get("refresh_token", "")
    if not refresh_tok:
        print("ERROR: No refresh token", file=sys.stderr)
        sys.exit(1)
    
    try:
        result = refresh(refresh_tok)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    data["access_token"] = result["access_token"]
    if "refresh_token" in result:
        data["refresh_token"] = result["refresh_token"]
    expires_in = result.get("expires_in", 900)
    new_exp = time.time() + expires_in
    data["expires_at"] = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(new_exp))
    data["inference_base_url"] = result.get("inference_base_url", "https://inference-api.nousresearch.com/v1")
    save_token(data)
    print(f"OK: Token refreshed, expires {data['expires_at']}")

if __name__ == "__main__":
    parser=argparse.ArgumentParser(description='Re/authorize Hermès token for Nous')
    parser.add_argument('--clear-cookies', action='store_true')
    parser.add_argument('--print-device-code', action='store_true')
    args=parser.parse_args()
    if args.print_device_code:
        print(device_code_url())
        sys.exit(0)
    main()
