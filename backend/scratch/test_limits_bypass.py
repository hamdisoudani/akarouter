import asyncio
import os
import sys
from dotenv import load_dotenv

# Set python path to backend root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()

from app.core.supabase import get_supabase
from app.core.router import authenticate_api_key, hash_api_key
from app.core.cache import evict_account_caches

API_KEY = "akar_Fnam8kmBmCLbf0EystiAi2zTiCWf9GZhsZs67BSPDds"

async def run_test():
    supabase = get_supabase()
    
    # 1. Get current values to restore later
    key_hash = hash_api_key(API_KEY)
    res = supabase.table("api_keys").select("*, accounts(*)").eq("key_hash", key_hash).execute()
    if not res.data:
        print("Error: Test API Key not found in DB.")
        sys.exit(1)
        
    key_info = res.data[0]
    account = key_info["accounts"]
    account_id = account["id"]
    orig_requests = account["monthly_requests"]
    orig_limit = account["monthly_limit"]
    
    print(f"Original state: monthly_requests={orig_requests}, monthly_limit={orig_limit}")
    
    try:
        # 2. Set monthly_requests > monthly_limit to simulate exceeding limit
        print("\nUpdating account to exceed request limit (requests=2000, limit=1000)...")
        supabase.table("accounts").update({
            "monthly_requests": 2000,
            "monthly_limit": 1000
        }).eq("id", account_id).execute()
        
        # Evict cache to ensure it fetches from DB
        evict_account_caches(account_id)
        
        # 3. Call authenticate_api_key (with check_limits=False to bypass token sliding budgets in test)
        print("Authenticating API key...")
        metadata = await authenticate_api_key(API_KEY, check_limits=False)
        
        if metadata:
            print("SUCCESS: Authentication succeeded even though monthly requests exceeded limit!")
        else:
            print("FAILURE: Authentication returned None (blocked by request limit)!")
            sys.exit(1)
            
    finally:
        # 4. Restore original values
        print("\nRestoring original account state...")
        supabase.table("accounts").update({
            "monthly_requests": orig_requests,
            "monthly_limit": orig_limit
        }).eq("id", account_id).execute()
        evict_account_caches(account_id)
        print("Restored successfully!")

if __name__ == "__main__":
    asyncio.run(run_test())
