import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase_url = os.environ.get("AKAROUTER_SUPABASE_URL")
supabase_key = os.environ.get("AKAROUTER_SUPABASE_SERVICE_ROLE_KEY")

supabase = create_client(supabase_url, supabase_key)

try:
    res = supabase.table("providers").select("*").execute()
    print("Providers in DB:")
    for row in res.data:
        print(f"ID: {row.get('id')}")
        print(f"  Label: {row.get('account_label')}")
        print(f"  Health: {row.get('health_status')}")
        print(f"  Weight: {row.get('weight')}")
        print(f"  In Flight: {row.get('in_flight')}")
        print(f"  Max Concurrent: {row.get('max_concurrent')}")
        print(f"  Expires: {row.get('token_expires_at')}")
        print("---")
except Exception as e:
    print(f"Error checking providers: {e}")
