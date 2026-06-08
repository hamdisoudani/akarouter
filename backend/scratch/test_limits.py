import os
import sys
import time
import uuid
from datetime import datetime, timezone
from unittest.mock import patch
from dotenv import load_dotenv

# Ensure backend directory is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from app.main import app
from app.core.supabase import get_supabase
from app.core.router import generate_api_key, hash_api_key
from app.core.cache import evict_account_caches

load_dotenv()

# We need the service role key to test admin endpoints
SERVICE_ROLE_KEY = os.environ.get("AKAROUTER_SUPABASE_SERVICE_ROLE_KEY")
if not SERVICE_ROLE_KEY:
    print("[ERROR] AKAROUTER_SUPABASE_SERVICE_ROLE_KEY not set in environment!")
    sys.exit(1)

client = TestClient(app)
supabase = get_supabase()

def run_tests():
    print("--- STARTING INTEGRATION TESTS FOR RATE LIMITS & BUDGETS ---")

    # 1. Retrieve an active account
    print("Fetching an active account...")
    acc_res = supabase.table("accounts").select("*").eq("status", "active").limit(1).execute()
    if not acc_res.data:
        print("[ERROR] No active account found in the database!")
        sys.exit(1)
        
    account = acc_res.data[0]
    account_id = account["id"]
    print(f"Using Account: ID={account_id}, Email={account.get('email')}, Tier={account.get('tier')}")

    # Store original limits to restore them during cleanup
    original_limits = {
        "rpm_limit": account.get("rpm_limit"),
        "tokens_5h_limit": account.get("tokens_5h_limit"),
        "tokens_7d_limit": account.get("tokens_7d_limit"),
        "budget_reset_at": account.get("budget_reset_at"),
    }
    print(f"Stored original limits: {original_limits}")

    # Generate a temporary API key for authentication
    raw_key, key_hash, key_prefix = generate_api_key()
    print(f"Generated temporary API key prefix: {key_prefix}")

    # Insert temporary API key into the DB
    supabase.table("api_keys").insert({
        "account_id": account_id,
        "key_hash": key_hash,
        "key_prefix": key_prefix,
        "key_name": "temp_integration_test_key",
        "scopes": ["chat:completion", "models:list"],
        "allowed_models": ["*"],
        "is_active": True
    }).execute()
    print("Temporary API key inserted into the database.")

    # Create cleanup helper
    def cleanup():
        print("\n--- CLEANING UP ---")
        try:
            # Delete temporary key
            supabase.table("api_keys").delete().eq("key_hash", key_hash).execute()
            print("Temporary API key deleted.")
            
            # Restore original limits
            supabase.table("accounts").update(original_limits).eq("id", account_id).execute()
            print("Original account limits restored.")
            
            # Clear local caches
            evict_account_caches(account_id)
            print("Account caches evicted.")
        except Exception as e:
            print(f"[WARNING] Cleanup error: {e}")

    try:
        # Mock upstream completions response to avoid actual Nous API billing
        mock_response = {
            "choices": [{"message": {"role": "assistant", "content": "Mocked completion response"}}],
            "usage": {
                "prompt_tokens": 100000,      # 100k input tokens = $0.02 at pro tier ($0.20/1M)
                "completion_tokens": 50000,   # 50k output tokens = $0.04 at pro tier ($0.80/1M)
                "total_tokens": 150000        # Total cost = $0.06
            }
        }

        with patch("app.api.chat._upstream", return_value=mock_response):
            
            # -------------------------------------------------------------
            # TEST 1: Admin update limits & budget reset
            # -------------------------------------------------------------
            print("\nTest 1: Admin updating limits...")
            admin_headers = {"Authorization": f"Bearer {SERVICE_ROLE_KEY}"}
            update_payload = {
                "rpm_limit": 3,
                "tokens_5h_limit": 1.0,
                "tokens_7d_limit": 5.0
            }
            r = client.patch(f"/admin/accounts/{account_id}", json=update_payload, headers=admin_headers)
            assert r.status_code == 200, f"Admin update account limits failed: {r.text}"
            print("Limits updated via admin route successfully.")

            # Reset budget progress via admin route
            print("Resetting budget progress via admin route...")
            r = client.post(f"/admin/accounts/{account_id}/reset-budget", headers=admin_headers)
            assert r.status_code == 200, f"Admin budget reset failed: {r.text}"
            print("Budget reset successfully.")

            # -------------------------------------------------------------
            # TEST 2: Validate /user/usage initial state
            # -------------------------------------------------------------
            print("\nTest 2: Verifying initial /user/usage endpoint state...")
            user_headers = {"Authorization": f"Bearer {raw_key}"}
            r = client.get("/user/usage", headers=user_headers)
            assert r.status_code == 200, f"Usage query failed: {r.text}"
            usage_data = r.json()
            print(f"Usage data: {usage_data}")
            assert usage_data["rpm_limit"] == 3
            assert usage_data["tokens_5h_limit"] == 1.0
            assert usage_data["tokens_7d_limit"] == 5.0
            assert usage_data["consumed_budget_5h"] == 0.0
            assert usage_data["progress_percentage_5h"] == 0.0
            print("Initial usage stats verified successfully.")

            # -------------------------------------------------------------
            # TEST 3: Requests Per Minute (RPM) Limiting
            # -------------------------------------------------------------
            print("\nTest 3: Testing RPM rate limiting...")
            # Request 1 (RPM 1/3)
            payload = {"model": "akarouter-pro", "messages": [{"role": "user", "content": "Test 1"}]}
            r = client.post("/v1/chat/completions", json=payload, headers=user_headers)
            assert r.status_code == 200, f"First request failed: {r.text}"
            
            # Request 2 (RPM 2/3)
            r = client.post("/v1/chat/completions", json=payload, headers=user_headers)
            assert r.status_code == 200, f"Second request failed: {r.text}"
            
            # Request 3 (RPM 3/3)
            r = client.post("/v1/chat/completions", json=payload, headers=user_headers)
            assert r.status_code == 200, f"Third request failed: {r.text}"
            
            # Request 4 (RPM 4/3 -> Should trigger 429)
            r = client.post("/v1/chat/completions", json=payload, headers=user_headers)
            assert r.status_code == 429, f"Fourth request did not trigger rate limit! {r.status_code} {r.text}"
            assert "Requests per minute limit exceeded" in r.json()["detail"]
            print("RPM rate limit successfully blocked request 4.")

            # -------------------------------------------------------------
            # TEST 4: Token Budget sliding window block
            # -------------------------------------------------------------
            print("\nTest 4: Testing token budget sliding window limiting...")
            # We want to test budget blocking. Let's set budget limits to $0.01 (extremely low)
            # The cost of one request is mock_response costing $0.06 (above $0.01)
            # Evict cache & update limits to RPM=10, 5h budget = 0.01
            update_payload = {
                "rpm_limit": 10,
                "tokens_5h_limit": 0.01,
                "tokens_7d_limit": 0.05
            }
            r = client.patch(f"/admin/accounts/{account_id}", json=update_payload, headers=admin_headers)
            assert r.status_code == 200, f"Admin update limits failed: {r.text}"
            
            # Reset budget to clear history
            r = client.post(f"/admin/accounts/{account_id}/reset-budget", headers=admin_headers)
            assert r.status_code == 200, f"Admin budget reset failed: {r.text}"
            
            # Make first completion request
            print("Sending request costing $0.06 (with limit $0.01)...")
            r = client.post("/v1/chat/completions", json=payload, headers=user_headers)
            assert r.status_code == 200, f"Request within budget failed: {r.text}"
            
            # The next request should be blocked because the consumed budget is now $0.06 >= $0.01
            print("Sending subsequent request...")
            r = client.post("/v1/chat/completions", json=payload, headers=user_headers)
            assert r.status_code == 429, f"Request was not blocked by budget limit! {r.status_code} {r.text}"
            assert "5-hour token budget exceeded" in r.json()["detail"]
            print("Token budget sliding window successfully blocked subsequent requests.")

            # Verify that `/user/usage` displays the consumed token counts and budget percentages (capped at 100%)
            import asyncio
            from app.core.cache import flush_buffers_to_db
            asyncio.run(flush_buffers_to_db())
            
            r = client.get("/user/usage", headers=user_headers)
            assert r.status_code == 200, f"Usage query failed: {r.text}"
            usage_data = r.json()
            print(f"Usage data after budget block: {usage_data}")
            assert usage_data["consumed_tokens_input"] >= 100000
            assert usage_data["consumed_tokens_output"] >= 50000
            assert usage_data["consumed_budget_5h"] >= 0.06
            assert usage_data["progress_percentage_5h"] == 100.0  # Capped at 100%
            print("Token and budget progress percentages verified.")

            # -------------------------------------------------------------
            # TEST 5: Admin Gift Reset
            # -------------------------------------------------------------
            print("\nTest 5: Testing Admin progress reset (gift mode)...")
            # Reset budget progress via admin route
            r = client.post(f"/admin/accounts/{account_id}/reset-budget", headers=admin_headers)
            assert r.status_code == 200, f"Admin budget reset failed: {r.text}"
            
            # Call completions again - should work now because reset ignores old logs
            print("Sending request after admin budget reset...")
            r = client.post("/v1/chat/completions", json=payload, headers=user_headers)
            assert r.status_code == 200, f"Request after budget reset failed: {r.text}"
            print("Admin budget reset successfully unblocked the user.")

            # Verify /user/usage progress percentages reset to 0% (since we start counting from reset_at)
            asyncio.run(flush_buffers_to_db())
            r = client.get("/user/usage", headers=user_headers)
            assert r.status_code == 200
            usage_data = r.json()
            print(f"Usage data after reset and single request: {usage_data}")
            assert usage_data["consumed_tokens_input"] == 100000  # only 1 request made since reset
            assert usage_data["consumed_budget_5h"] == 0.06
            # since $0.06 >= limit of $0.01, progress percentage is capped at 100.0%
            print("Progress telemetry reset verified.")

        print("\n--- ALL LIMITS & BUDGETS INTEGRATION TESTS PASSED SUCCESSFULLY! ---")

    except Exception as e:
        print(f"\n[ERROR] Test assertion failed: {e}")
        import traceback
        traceback.print_exc()
        cleanup()
        sys.exit(1)

    cleanup()

if __name__ == "__main__":
    run_tests()
