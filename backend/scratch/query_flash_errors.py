import os
import sys
from dotenv import load_dotenv

# Ensure backend directory is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.supabase import get_supabase

# Load env
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

supabase = get_supabase()

def query():
    print("--- FAILED REQUESTS (STATUS >= 400) ---")
    res = (
        supabase.table("request_logs")
        .select("created_at, account_id, api_key_id, provider_id, model, upstream_model, status_code, latency_ms, error_message")
        .gte("status_code", 400)
        .order("created_at", desc=True)
        .limit(10)
        .execute()
    )
    for row in res.data:
        print(f"Time: {row['created_at']}")
        print(f"  Model: {row['model']}")
        print(f"  Upstream Model: {row['upstream_model']}")
        print(f"  Status Code: {row['status_code']}")
        print(f"  Error Message: {row['error_message']}")
        print("-" * 40)

    print("\n--- ALL REQUESTS FOR AKAROUTER-FLASH ---")
    res_flash = (
        supabase.table("request_logs")
        .select("created_at, account_id, api_key_id, provider_id, model, upstream_model, status_code, latency_ms, error_message")
        .eq("model", "akarouter-flash")
        .order("created_at", desc=True)
        .limit(10)
        .execute()
    )
    for row in res_flash.data:
        print(f"Time: {row['created_at']}")
        print(f"  Status Code: {row['status_code']}")
        print(f"  Error Message: {row['error_message']}")
        print("-" * 40)

if __name__ == "__main__":
    query()
