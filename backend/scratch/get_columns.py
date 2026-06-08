import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase_url = os.environ.get("AKAROUTER_SUPABASE_URL")
supabase_key = os.environ.get("AKAROUTER_SUPABASE_SERVICE_ROLE_KEY")

supabase = create_client(supabase_url, supabase_key)

try:
    # Query database catalog columns via SQL or RPC or table select (we can query informaton_schema via supabase rest api?)
    # Rest API doesn't allow direct SQL queries unless we have an RPC, but we can try to select a non-existent column or just select *
    # Wait, we can run a select query with a filter that returns nothing but gives column names? No, PostgREST doesn't return column headers on empty list.
    # But wait! The error message we got earlier was:
    # 'column request_logs.status does not exist'
    # Let's try to query 'http_status' to see if it exists!
    res = supabase.table("request_logs").select("status_code").limit(1).execute()
    print("status_code exists!")
except Exception as e:
    print("status_code error:", e)

try:
    res = supabase.table("request_logs").select("http_status").limit(1).execute()
    print("http_status exists!")
except Exception as e:
    print("http_status error:", e)

try:
    res = supabase.table("request_logs").select("status").limit(1).execute()
    print("status exists!")
except Exception as e:
    print("status error:", e)
