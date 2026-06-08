import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase_url = os.environ.get("AKAROUTER_SUPABASE_URL")
supabase_key = os.environ.get("AKAROUTER_SUPABASE_SERVICE_ROLE_KEY")

supabase = create_client(supabase_url, supabase_key)

try:
    res = supabase.table("providers").update({"health_status": "active"}).eq("account_label", "hermes-mq3hpeur").execute()
    print("Reset health to active successfully!")
    print(res.data)
except Exception as e:
    print(f"Error resetting health: {e}")
