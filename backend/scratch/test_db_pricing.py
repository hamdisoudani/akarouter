import asyncio
import os
import sys
from dotenv import load_dotenv

# Set python path to backend root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()

from app.core.supabase import get_supabase
from app.core.cache import evict_model_active_cache, get_model_metadata
from app.core.router import log_request

async def run_test():
    supabase = get_supabase()
    
    # 1. Fetch current pricing to restore later
    res = supabase.table("model_mapping").select("*").eq("alias", "akarouter-pro").execute()
    if not res.data:
        print("Error: Model 'akarouter-pro' not found in model_mapping.")
        sys.exit(1)
        
    model_row = res.data[0]
    orig_input = model_row.get("input_cost_per_million")
    orig_output = model_row.get("output_cost_per_million")
    
    print(f"Original akarouter-pro pricing: Input={orig_input}, Output={orig_output}")
    
    try:
        # 2. Update model pricing in DB
        print("\nUpdating akarouter-pro pricing in DB to Input=$0.50, Output=$1.50...")
        supabase.table("model_mapping").update({
            "input_cost_per_million": 0.50,
            "output_cost_per_million": 1.50
        }).eq("alias", "akarouter-pro").execute()
        
        # Evict cache to guarantee fetch
        evict_model_active_cache("akarouter-pro")
        
        # 3. Fetch metadata and assert
        meta = get_model_metadata("akarouter-pro")
        print(f"Fetched metadata: {meta}")
        assert meta["input_cost_per_million"] == 0.50, "Input cost mismatch"
        assert meta["output_cost_per_million"] == 1.50, "Output cost mismatch"
        
        # 4. Log request mock check
        # Cost of 1,000,000 prompt tokens and 1,000,000 completion tokens should be $0.50 + $1.50 = $2.00
        # Wait, let's verify if log_request calculates cost correctly
        # Let's import log_request and mock the logging buffer
        from app.core.cache import _request_log_buffer
        _request_log_buffer.clear()
        
        await log_request(
            account_id="2a52540b-f572-493b-909b-5fb5c321dd47",
            api_key_id="some-key",
            provider_id="some-provider",
            model="akarouter-pro",
            upstream_model="stepfun/step-3.7-flash:free",
            status_code=200,
            latency_ms=150,
            prompt_tokens=1_000_000,
            completion_tokens=1_000_000,
            total_tokens=2_000_000
        )
        
        assert len(_request_log_buffer) == 1, "Log not buffered"
        logged_cost = _request_log_buffer[0]["cost"]
        print(f"Calculated logged request cost: ${logged_cost}")
        assert abs(logged_cost - 2.00) < 1e-6, f"Expected cost $2.00, got ${logged_cost}"
        print("SUCCESS: Dynamic cost calculation verified correctly!")
        
    finally:
        # 5. Restore original pricing
        print("\nRestoring original model pricing...")
        supabase.table("model_mapping").update({
            "input_cost_per_million": orig_input,
            "output_cost_per_million": orig_output
        }).eq("alias", "akarouter-pro").execute()
        evict_model_active_cache("akarouter-pro")
        print("Restored successfully!")

if __name__ == "__main__":
    asyncio.run(run_test())
