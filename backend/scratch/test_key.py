import json
import httpx
import sys
from datetime import datetime

# API Key provided by the user
API_KEY = "akar_Fnam8kmBmCLbf0EystiAi2zTiCWf9GZhsZs67BSPDds"
BASE_URL = "http://127.0.0.1:8000"

print("--- TESTING API KEY AGAINST LOCAL GATEWAY ---")
print(f"API Key: {API_KEY[:10]}...{API_KEY[-10:]}")
print(f"Base URL: {BASE_URL}")

# Check key status in DB before request
try:
    from app.core.supabase import get_supabase
    from app.core.router import hash_api_key
    
    supabase = get_supabase()
    key_hash = hash_api_key(API_KEY)
    
    # Get key info
    res = supabase.table("api_keys").select("*, accounts(*)").eq("key_hash", key_hash).execute()
    if not res.data:
        print("\n[ERROR] Key hash not found in database!")
        sys.exit(1)
        
    key_info = res.data[0]
    account_info = key_info.get("accounts", {})
    print(f"\n[DB STATE BEFORE TEST]")
    print(f"Key ID: {key_info.get('id')}")
    print(f"Key Label: {key_info.get('key_name')}")
    print(f"Key Active: {key_info.get('is_active')}")
    print(f"Last Used At: {key_info.get('last_used_at')}")
    print(f"Account ID: {account_info.get('id')}")
    print(f"Account Email: {account_info.get('email')}")
    print(f"Account Status: {account_info.get('status')}")
    print(f"Account Monthly Requests: {account_info.get('monthly_requests')}")
    print(f"Account Monthly Limit: {account_info.get('monthly_limit')}")
    
    init_requests = account_info.get('monthly_requests', 0)
except Exception as e:
    print(f"\n[WARNING] Could not read from database directly: {e}")
    init_requests = None

# Send chat completion request
print("\n[SENDING REQUEST TO /v1/chat/completions...]")
payload = {
    "model": "akarouter-pro",
    "messages": [
        {"role": "user", "content": "Hello, this is a security and functionality test request."}
    ],
    "stream": False,
    "temperature": 0.7
}

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

try:
    response = httpx.post(f"{BASE_URL}/v1/chat/completions", json=payload, headers=headers, timeout=60.0)
    print(f"Response Status Code: {response.status_code}")
    print(f"Response Headers: {dict(response.headers)}")
    
    try:
        resp_json = response.json()
        print(f"Response Body:\n{json.dumps(resp_json, indent=2)}")
    except Exception:
        print(f"Response Raw Text:\n{response.text}")
        
    if response.status_code != 200:
        print(f"\n[FAILED] Request failed with status code {response.status_code}")
        sys.exit(1)
        
except Exception as e:
    print(f"\n[ERROR] Request execution failed: {e}")
    sys.exit(1)

# Check DB state after request
if init_requests is not None:
    print("\n[DB STATE AFTER TEST]")
    try:
        res = supabase.table("api_keys").select("*, accounts(*)").eq("key_hash", key_hash).execute()
        key_info = res.data[0]
        account_info = key_info.get("accounts", {})
        print(f"Last Used At: {key_info.get('last_used_at')}")
        print(f"Account Monthly Requests: {account_info.get('monthly_requests')}")
        
        diff = account_info.get('monthly_requests', 0) - init_requests
        print(f"Requests Counter Increment: +{diff}")
        if diff == 1:
            print("\n[SUCCESS] Credits/quota system successfully tracked the request!")
        else:
            print("\n[WARNING] Monthly request counter did not increment by exactly 1.")
    except Exception as e:
        print(f"Failed to check DB state: {e}")
