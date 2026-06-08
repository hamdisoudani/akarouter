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
from app.core.router import generate_api_key, hash_api_key
from app.core.cache import evict_account_caches, evict_system_settings_cache, evict_model_active_cache

# Load env from backend/ directory
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

SERVICE_ROLE_KEY = os.environ.get("AKAROUTER_SUPABASE_SERVICE_ROLE_KEY")
if not SERVICE_ROLE_KEY:
    print("[ERROR] AKAROUTER_SUPABASE_SERVICE_ROLE_KEY not set in environment!")
    sys.exit(1)

client = TestClient(app)
supabase = get_supabase()

def run_tests():
    print("--- STARTING INTEGRATION TESTS FOR ADMIN CONTROLS ---")

    # 1. Fetch active account
    acc_res = supabase.table("accounts").select("*").eq("status", "active").limit(1).execute()
    if not acc_res.data:
        print("[ERROR] No active account found in DB!")
        sys.exit(1)
    account = acc_res.data[0]
    account_id = account["id"]
    print(f"Using Account: ID={account_id}, Email={account['email']}, Status={account['status']}")

    original_account_status = account["status"]
    original_suspended_reason = account.get("suspended_reason")

    # Generate temporary API key
    raw_key, key_hash, key_prefix = generate_api_key()
    supabase.table("api_keys").insert({
        "account_id": account_id,
        "key_hash": key_hash,
        "key_prefix": key_prefix,
        "key_name": "temp_admin_test_key",
        "scopes": ["chat:completion", "models:list"],
        "allowed_models": ["*"],
        "is_active": True
    }).execute()
    print("Inserted temporary API key.")

    # Save original gateway setting
    gw_res = supabase.table("system_settings").select("value").eq("key", "gateway_enabled").execute()
    original_gateway_enabled = gw_res.data[0]["value"] if gw_res.data else "true"

    # Save original model settings
    models_res = supabase.table("model_mapping").select("*").execute()
    original_models = {row["alias"]: row["is_active"] for row in models_res.data}

    # Ensure akarouter-pro and akarouter-flash rows exist
    for alias in ["akarouter-pro", "akarouter-flash"]:
        if alias not in original_models:
            supabase.table("model_mapping").insert({
                "alias": alias,
                "upstream_model": "default-upstream",
                "display_name": alias.title(),
                "is_active": True
            }).execute()
            original_models[alias] = True

    def cleanup():
        print("\n--- CLEANING UP TEST STATE ---")
        try:
            # Delete temp key
            supabase.table("api_keys").delete().eq("key_hash", key_hash).execute()
            # Restore account status
            supabase.table("accounts").update({
                "status": original_account_status,
                "suspended_reason": original_suspended_reason
            }).eq("id", account_id).execute()
            evict_account_caches(account_id)
            # Restore gateway settings
            supabase.table("system_settings").upsert({"key": "gateway_enabled", "value": original_gateway_enabled}).execute()
            evict_system_settings_cache()
            # Restore model status
            for alias, val in original_models.items():
                supabase.table("model_mapping").update({"is_active": val}).eq("alias", alias).execute()
                evict_model_active_cache(alias)
            print("Cleanup successful.")
        except Exception as e:
            print(f"[WARNING] Cleanup error: {e}")

    try:
        mock_response = {
            "choices": [{"message": {"role": "assistant", "content": "Mocked completion response"}}],
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50,
                "total_tokens": 150
            }
        }

        with patch("app.api.chat._upstream", return_value=mock_response):
            headers = {"Authorization": f"Bearer {raw_key}"}
            admin_headers = {"Authorization": f"Bearer {SERVICE_ROLE_KEY}"}

            # -------------------------------------------------------------
            # TEST 1: Get & Update System Settings (Gateway Enable/Disable)
            # -------------------------------------------------------------
            print("\n[TEST 1] Testing Gateway Toggle...")
            
            # Fetch settings
            res = client.get("/admin/settings", headers=admin_headers)
            assert res.status_code == 200, f"Get settings failed: {res.text}"
            print(f"Current Settings: {res.json()}")

            # Disable gateway
            res = client.patch("/admin/settings", json={"gateway_enabled": False}, headers=admin_headers)
            assert res.status_code == 200, f"Disable settings failed: {res.text}"
            
            # Verify blocked endpoints under /v1/*
            res = client.post("/v1/chat/completions", json={"model": "akarouter-pro", "messages": [{"role": "user", "content": "hi"}]}, headers=headers)
            assert res.status_code == 503, f"Expected 503 for disabled gateway, got {res.status_code}: {res.text}"
            assert "detail" in res.json()
            print("Successfully blocked completions with 503 when gateway disabled.")

            # Enable gateway again
            res = client.patch("/admin/settings", json={"gateway_enabled": True}, headers=admin_headers)
            assert res.status_code == 200
            
            # Verify allowed again
            res = client.post("/v1/chat/completions", json={"model": "akarouter-pro", "messages": [{"role": "user", "content": "hi"}]}, headers=headers)
            assert res.status_code == 200, f"Expected 200 after enabling gateway, got {res.status_code}: {res.text}"
            print("Successfully resumed completions with 200 after enabling gateway.")

            # -------------------------------------------------------------
            # TEST 2: Disable / Enable individual model
            # -------------------------------------------------------------
            print("\n[TEST 2] Testing Model Toggle...")

            # Disable model
            res = client.patch("/admin/models/akarouter-pro", json={"is_active": False}, headers=admin_headers)
            assert res.status_code == 200
            
            # Check models list returns it but with is_active: false
            res = client.get("/v1/models")
            assert res.status_code == 200
            models_list = res.json()["data"]
            pro_model = next((m for m in models_list if m["id"] == "akarouter-pro"), None)
            assert pro_model is not None, "akarouter-pro missing from models list"
            assert pro_model["is_active"] is False, "akarouter-pro should have is_active=False"
            print("Models list returns deactivated model with is_active=False.")

            # Call deactivated model
            res = client.post("/v1/chat/completions", json={"model": "akarouter-pro", "messages": [{"role": "user", "content": "hi"}]}, headers=headers)
            assert res.status_code == 400, f"Expected 400 for disabled model, got {res.status_code}: {res.text}"
            assert "disabled by administrator" in res.json()["detail"]
            print("Successfully blocked calling disabled model with 400 Bad Request.")

            # Enable model again
            res = client.patch("/admin/models/akarouter-pro", json={"is_active": True}, headers=admin_headers)
            assert res.status_code == 200

            res = client.post("/v1/chat/completions", json={"model": "akarouter-pro", "messages": [{"role": "user", "content": "hi"}]}, headers=headers)
            assert res.status_code == 200, f"Expected 200 after enabling model, got {res.status_code}: {res.text}"
            print("Successfully resumed calling model after enabling it.")

            # -------------------------------------------------------------
            # TEST 3: Suspended / Banned User Blocks
            # -------------------------------------------------------------
            print("\n[TEST 3] Testing Suspension Enforcement...")

            # Suspend user
            res = client.patch(f"/admin/accounts/{account_id}", json={"status": "suspended", "suspended_reason": "Terms Violation"}, headers=admin_headers)
            assert res.status_code == 200
            
            # Call completions with API key
            res = client.post("/v1/chat/completions", json={"model": "akarouter-pro", "messages": [{"role": "user", "content": "hi"}]}, headers=headers)
            assert res.status_code == 403, f"Expected 403 for suspended user, got {res.status_code}: {res.text}"
            assert "suspended" in res.json()["detail"]
            print("Successfully blocked suspended API key request with 403 Forbidden.")

            # Reactivate user
            res = client.patch(f"/admin/accounts/{account_id}", json={"status": "active", "suspended_reason": None}, headers=admin_headers)
            assert res.status_code == 200

            res = client.post("/v1/chat/completions", json={"model": "akarouter-pro", "messages": [{"role": "user", "content": "hi"}]}, headers=headers)
            assert res.status_code == 200, f"Expected 200 after reactivating user, got {res.status_code}: {res.text}"
            print("Successfully completed request after reactivating user.")

            # -------------------------------------------------------------
            # TEST 4: Global Telemetry and User Consumptions
            # -------------------------------------------------------------
            print("\n[TEST 4] Testing Admin Diagnostics & Telemetry...")
            
            res = client.get("/admin/stats", headers=admin_headers)
            assert res.status_code == 200
            stats_data = res.json()
            assert "global_telemetry" in stats_data
            global_tel = stats_data["global_telemetry"]
            print(f"Global Telemetry: {global_tel}")

            res = client.get("/admin/accounts", headers=admin_headers)
            assert res.status_code == 200
            acc_list = res.json()["accounts"]
            test_acc = next((a for a in acc_list if a["id"] == account_id), None)
            assert test_acc is not None
            assert "consumption" in test_acc
            print(f"Account Consumption: {test_acc['consumption']}")

        print("\n--- ALL TESTS PASSED SUCCESSFULLY! ---")
    finally:
        cleanup()

if __name__ == "__main__":
    run_tests()
