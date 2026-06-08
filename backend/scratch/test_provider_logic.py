import asyncio
import os
import sys
import logging
from dotenv import load_dotenv

# Set python path to backend root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("test_provider_logic")

load_dotenv()

from app.core.supabase import get_supabase
from app.core.router import select_provider, release_provider
from app.core.cache import reset_consecutive_errors

async def run_test():
    supabase = get_supabase()
    
    # 1. Ensure the provider 'hermes-mq3hpeur' is active at the start of the test
    logger.info("Ensuring hermes-mq3hpeur is 'active' in DB...")
    res = supabase.table("providers").update({"health_status": "active"}).eq("account_label", "hermes-mq3hpeur").execute()
    provider_id = res.data[0]["id"]
    logger.info(f"Provider ID: {provider_id}")
    
    # Reset in-memory error count to be clean
    reset_consecutive_errors(provider_id)
    
    # 2. Test initial selection
    logger.info("\n--- Test Case 1: Initial Selection ---")
    provider = await select_provider("akarouter-pro")
    if provider and provider["id"] == provider_id:
        logger.info(f"SUCCESS: Correctly selected active provider '{provider['account_label']}'")
    else:
        logger.error(f"FAILURE: Expected to select provider_id {provider_id}, got {provider}")
        sys.exit(1)
        
    # 3. Test first and second failure (consecutive error thresholds)
    logger.info("\n--- Test Case 2: First Failure (Should NOT degrade in DB) ---")
    await release_provider(provider_id, success=False, error_msg="Transient error 1")
    
    # Check DB status
    db_provider = supabase.table("providers").select("health_status").eq("id", provider_id).execute().data[0]
    logger.info(f"Health status after 1st failure: '{db_provider['health_status']}' (Expected: 'active')")
    assert db_provider["health_status"] == "active", "Provider was degraded on 1st failure!"
    
    logger.info("\n--- Test Case 3: Second Failure (Should NOT degrade in DB) ---")
    await release_provider(provider_id, success=False, error_msg="Transient error 2")
    
    # Check DB status
    db_provider = supabase.table("providers").select("health_status").eq("id", provider_id).execute().data[0]
    logger.info(f"Health status after 2nd failure: '{db_provider['health_status']}' (Expected: 'active')")
    assert db_provider["health_status"] == "active", "Provider was degraded on 2nd failure!"
    
    # 4. Test third failure (Should degrade in DB)
    logger.info("\n--- Test Case 4: Third Failure (Should degrade in DB) ---")
    await release_provider(provider_id, success=False, error_msg="Transient error 3")
    
    # Check DB status
    db_provider = supabase.table("providers").select("health_status, last_error_msg").eq("id", provider_id).execute().data[0]
    logger.info(f"Health status after 3rd failure: '{db_provider['health_status']}' (Expected: 'degraded')")
    logger.info(f"Last error message: '{db_provider['last_error_msg']}'")
    assert db_provider["health_status"] == "degraded", "Provider was not degraded after 3 failures!"
    
    # 5. Test selection fallback (Should fallback to degraded provider)
    logger.info("\n--- Test Case 5: Selection Fallback (Should select degraded provider since no active exists) ---")
    provider_fallback = await select_provider("akarouter-pro")
    if provider_fallback and provider_fallback["id"] == provider_id:
        logger.info(f"SUCCESS: Fallback successfully picked degraded provider '{provider_fallback['account_label']}'")
    else:
        logger.error(f"FAILURE: Expected to select degraded provider, got {provider_fallback}")
        sys.exit(1)
        
    # 6. Test successful release (Should auto-heal provider to 'active')
    logger.info("\n--- Test Case 6: Successful Release (Should auto-heal to active) ---")
    await release_provider(provider_id, success=True)
    
    # Check DB status
    db_provider = supabase.table("providers").select("health_status").eq("id", provider_id).execute().data[0]
    logger.info(f"Health status after success: '{db_provider['health_status']}' (Expected: 'active')")
    assert db_provider["health_status"] == "active", "Provider was not auto-healed to active!"
    
    logger.info("\n=== ALL TESTS PASSED SUCCESSFULLY ===")

if __name__ == "__main__":
    asyncio.run(run_test())
