#!/usr/bin/env python3
"""Nous OAuth token refresher for OpenClaw custom provider."""
import json, os, time, urllib.request, urllib.error

AUTH_DIR = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(AUTH_DIR, "token.json")

PORTAL_URL = "https://portal.nousresearch.com"
CLIENT_ID = "hermes-cli"

def load_token():
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE) as f:
            return json.load(f)
    return None

def save_token(data):
    data["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
    with open(TOKEN_FILE, "w") as f:
        json.dump(data, f, indent=2)
    os.chmod(TOKEN_FILE, 0o600)

def refresh(refresh_token):
    """Refresh the access token via Nous Portal API."""
    url = f"{PORTAL_URL}/api/oauth/token"
    body = f"grant_type=refresh_token&client_id={CLIENT_ID}".encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    req.add_header("x-nous-refresh-token", refresh_token)
    
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            result = json.loads(resp.read().decode())
            if "access_token" not in result:
                raise ValueError("No access_token in response")
            return result
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Token refresh failed: {e.code} {e.read().decode()[:500]}")

def get_access_token():
    """Get a valid access token, refreshing if needed."""
    data = load_token()
    if not data:
        raise RuntimeError("No token data found. Run initial setup first.")
    
    access_token = data.get("access_token", "")
    expires_at = data.get("expires_at", "")
    refresh_tok = data.get("refresh_token", "")
    
    # Check if token is still valid (with 2 min buffer)
    if expires_at and access_token:
        exp_time = time.mktime(time.strptime(expires_at, "%Y-%m-%dT%H:%M:%S+00:00"))
        if time.time() < exp_time - 120:
            return access_token
    
    # Need to refresh
    if not refresh_tok:
        raise RuntimeError("No refresh token available. Re-auth needed.")
    
    print(f"Refreshing Nous token (expired at {expires_at})...", flush=True)
    result = refresh(refresh_tok)
    
    # Update stored data
    data["access_token"] = result["access_token"]
    if "refresh_token" in result:
        data["refresh_token"] = result["refresh_token"]
    
    # Calculate new expiry
    expires_in = result.get("expires_in", 900)
    new_exp = time.time() + expires_in
    data["expires_at"] = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(new_exp))
    data["inference_base_url"] = result.get("inference_base_url", "https://inference-api.nousresearch.com/v1")
    
    save_token(data)
    return data["access_token"]

if __name__ == "__main__":
    token = get_access_token()
    print(token)
