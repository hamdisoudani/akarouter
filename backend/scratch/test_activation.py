import os
import sys
import time
from unittest.mock import patch
from dotenv import load_dotenv

# Ensure backend directory is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from app.main import app
from app.core.supabase import get_supabase
from app.core.cache import evict_account_caches, evict_jwt_cache

# Load env from backend/ directory
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

SERVICE_ROLE_KEY = os.environ.get("AKAROUTER_SUPABASE_SERVICE_ROLE_KEY")
if not SERVICE_ROLE_KEY:
    print("[ERROR] AKAROUTER_SUPABASE_SERVICE_ROLE_KEY not set in environment!")
    sys.exit(1)

client = TestClient(app)
supabase = get_supabase()

def run_tests():
    print("--- STARTING INTEGRATION TESTS FOR ACCOUNT ACTIVATION ---")

    # 1. Fetch active account to use for testing
    acc_res = supabase.table("accounts").select("*").eq("status", "active").limit(1).execute()
    if not acc_res.data:
        print("[ERROR] No active account found in DB!")
        sys.exit(1)
    account = acc_res.data[0]
    account_id = account["id"]
    email = account["email"]
    print(f"Using test account: ID={account_id}, Email={email}")

    original_account_status = account["status"]

    # 2. Helper to clean up
    def cleanup():
        print("\n--- CLEANING UP TEST STATE ---")
        try:
            # Restore account status to active
            supabase.table("accounts").update({"status": original_account_status}).eq("id", account_id).execute()
            # Delete any generated invitation codes
            supabase.table("invitation_codes").delete().eq("code", "TESTACTIVATIONCODE").execute()
            supabase.table("invitation_codes").delete().eq("code", "TESTACTIVATIONCODE2").execute()
            # Clear cache
            evict_account_caches(account_id)
            evict_jwt_cache("eyJ_mock_token")
            print("Cleanup successful.")
        except Exception as e:
            print(f"[WARNING] Cleanup error: {e}")

    try:
        # Create a test invitation code with max_uses = 1
        supabase.table("invitation_codes").delete().eq("code", "TESTACTIVATIONCODE").execute()
        supabase.table("invitation_codes").insert({
            "code": "TESTACTIVATIONCODE",
            "max_uses": 1,
            "used_count": 0,
            "is_active": True
        }).execute()
        print("Created test invitation code TESTACTIVATIONCODE (uses=1)")

        # Create another test invitation code with max_uses = 2
        supabase.table("invitation_codes").delete().eq("code", "TESTACTIVATIONCODE2").execute()
        supabase.table("invitation_codes").insert({
            "code": "TESTACTIVATIONCODE2",
            "max_uses": 2,
            "used_count": 0,
            "is_active": True
        }).execute()
        print("Created test invitation code TESTACTIVATIONCODE2 (uses=2)")

        # Setup mock user jwt info
        mock_user_pending = {
            "account_id": account_id,
            "email": email,
            "role": "user",
            "status": "pending"
        }
        mock_user_active = {
            "account_id": account_id,
            "email": email,
            "role": "user",
            "status": "active"
        }

        # Mocking JWT validation and recaptcha helper
        current_status = "pending"
        def mock_verify_jwt(token_str):
            if current_status == "pending":
                return mock_user_pending
            return mock_user_active

        with patch("app.main._verify_supabase_jwt", side_effect=mock_verify_jwt), \
             patch("app.core.recaptcha.verify_recaptcha", return_value=True):

            headers = {"Authorization": "Bearer eyJ_mock_token"}

            # Set user status in DB to pending
            supabase.table("accounts").update({"status": "pending"}).eq("id", account_id).execute()
            evict_account_caches(account_id)
            evict_jwt_cache("eyJ_mock_token")

            # -------------------------------------------------------------
            # TEST 1: Pending User block of forbidden endpoints
            # -------------------------------------------------------------
            print("\n[TEST 1] Verifying that pending status blocks /user/keys...")
            res = client.get("/user/keys", headers=headers)
            assert res.status_code == 403, f"Expected 403, got {res.status_code}: {res.text}"
            print("Successfully blocked access to /user/keys for pending account.")

            # -------------------------------------------------------------
            # TEST 2: Submit invalid invitation code
            # -------------------------------------------------------------
            print("\n[TEST 2] Submitting invalid code...")
            res = client.post("/user/activate", json={"code": "INVALID_CODE", "recaptcha_token": "token"}, headers=headers)
            assert res.status_code == 400, f"Expected 400, got {res.status_code}: {res.text}"
            assert "Invalid or inactive" in res.json()["detail"]
            print("Successfully rejected invalid invitation code.")

            # -------------------------------------------------------------
            # TEST 3: Submit valid invitation code
            # -------------------------------------------------------------
            print("\n[TEST 3] Submitting valid code...")
            res = client.post("/user/activate", json={"code": "TESTACTIVATIONCODE", "recaptcha_token": "token"}, headers=headers)
            assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
            print("Successfully activated account!")

            # Verify status in database
            db_res = supabase.table("accounts").select("status").eq("id", account_id).execute()
            assert db_res.data[0]["status"] == "active", f"Status should be active, got {db_res.data[0]['status']}"
            print("Status in database is verified as active.")

            # Verify invitation code is disabled/deactivated
            inv_res = supabase.table("invitation_codes").select("is_active", "used_count").eq("code", "TESTACTIVATIONCODE").execute()
            assert inv_res.data[0]["is_active"] is False, "Code is_active should be False"
            assert inv_res.data[0]["used_count"] == 1, f"used_count should be 1, got {inv_res.data[0]['used_count']}"
            print("Invitation code usage count incremented and deactivated.")

            # Toggle status to active for JWT mock
            current_status = "active"
            evict_jwt_cache("eyJ_mock_token")

            # Verify endpoints are now unblocked
            res = client.get("/user/keys", headers=headers)
            assert res.status_code == 200, f"Expected 200 after activation, got {res.status_code}: {res.text}"
            print("Successfully accessed /user/keys after activation.")

            # -------------------------------------------------------------
            # TEST 4: Rate Limiting on /user/activate
            # -------------------------------------------------------------
            print("\n[TEST 4] Testing Rate Limiting (5 RPM)...")
            # Clear rate limit tracker to ensure isolation
            from app.core.cache import _activation_trackers
            _activation_trackers.clear()

            # Set user back to pending
            current_status = "pending"
            supabase.table("accounts").update({"status": "pending"}).eq("id", account_id).execute()
            evict_account_caches(account_id)
            evict_jwt_cache("eyJ_mock_token")

            # Call /user/activate 5 times (should succeed or return invalid code error)
            # 6th time should return 429
            for i in range(5):
                res = client.post("/user/activate", json={"code": "INVALID_CODE", "recaptcha_token": "token"}, headers=headers)
                assert res.status_code == 400, f"Expected 400, got {res.status_code}"
            
            # 6th attempt
            res = client.post("/user/activate", json={"code": "INVALID_CODE", "recaptcha_token": "token"}, headers=headers)
            assert res.status_code == 429, f"Expected 429 Too Many Requests, got {res.status_code}: {res.text}"
            assert "Too many activation attempts" in res.json()["detail"]
            print("Successfully triggered 429 rate limit after 5 attempts.")

        print("\n--- ALL TESTS PASSED SUCCESSFULLY! ---")
    finally:
        cleanup()

if __name__ == "__main__":
    run_tests()
