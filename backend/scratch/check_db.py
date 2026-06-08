import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase_url = os.environ.get("AKAROUTER_SUPABASE_URL")
supabase_key = os.environ.get("AKAROUTER_SUPABASE_SERVICE_ROLE_KEY")

print(f"URL: {supabase_url}")
print(f"Key prefix: {supabase_key[:15] if supabase_key else 'None'}")

supabase = create_client(supabase_url, supabase_key)

try:
    res = supabase.table("accounts").select("id, email, auth_user_id, role").execute()
    print("Accounts in DB:")
    for row in res.data:
        print(row)
except Exception as e:
    print(f"Error: {e}")
