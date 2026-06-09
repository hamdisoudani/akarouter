import asyncio
import os
import sys
from dotenv import load_dotenv

# Set python path to backend root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()

from app.core.supabase import get_supabase
from app.core.router import authenticate_api_key, hash_api_key, BudgetLimitException
from app.core.cache import evict_account_caches

API_KEY = "akar_Fnam8kmBmCLbf0EystiAi2zTiCWf9GZhsZs67BSPDds"

async def run_test():
    supabase = get_supabase()
    
    # 1. Fetch current values to restore later
    key_hash = hash_api_key(API_KEY)
    res = supabase.table("api_keys").select("*, accounts(*)").eq("key_hash", key_hash).execute()
    if not res.data:
        print("Error: Test API Key not found in DB.")
        sys.exit(1)
        
    key_info = res.data[0]
    account = key_info["accounts"]
    account_id = account["id"]
    orig_limit = account["monthly_limit"]
    
    print(f"Original Monthly Limit (USD): ${orig_limit}")
    
    try:
        # 2. Set monthly limit very low ($0.0) to trigger exceeding limit
        print("\nUpdating monthly limit to $0.0 to trigger enforcement...")
        supabase.table("accounts").update({
            "monthly_limit": 0.0
        }).eq("id", account_id).execute()
        
        # Force clear caches directly to guarantee cache miss
        from app.core.cache import _api_key_cache, _account_budgets
        _api_key_cache.clear()
        _account_budgets.clear()
        
        # Query DB directly to check what it returns
        res_db = supabase.table("api_keys").select("*, accounts(*)").eq("key_hash", key_hash).execute()
        print(f"Direct DB query result: {res_db.data[0]['accounts']}")
        
        # Print budget state before check
        from app.core.cache import get_account_budget
        print(f"Cached budget state: {get_account_budget(account_id)}")
        
        # 3. Authenticate and check if it throws BudgetLimitException
        print("Attempting to authenticate...")
        try:
            metadata = await authenticate_api_key(API_KEY, check_limits=True)
            print(f"Auth metadata returned: monthly_limit={metadata.get('monthly_limit')}")
            print(f"Current cache budget state: {get_account_budget(account_id)}")
            print("FAILURE: Authentication succeeded but should have failed due to exceeded monthly budget!")
            sys.exit(1)
        except BudgetLimitException as e:
            print(f"SUCCESS: Correctly raised BudgetLimitException: {e}")
            assert "Monthly token budget exceeded" in str(e)
            
    finally:
        # 4. Restore original values
        print("\nRestoring original account monthly limit...")
        supabase.table("accounts").update({
            "monthly_limit": orig_limit
        }).eq("id", account_id).execute()
        evict_account_caches(account_id)
        print("Restored successfully!")

if __name__ == "__main__":
    asyncio.run(run_test())
