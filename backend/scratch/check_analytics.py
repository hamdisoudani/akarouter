import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase_url = os.environ.get("AKAROUTER_SUPABASE_URL")
supabase_key = os.environ.get("AKAROUTER_SUPABASE_SERVICE_ROLE_KEY")

supabase = create_client(supabase_url, supabase_key)

account_id = "2a52540b-f572-493b-909b-5fb5c321dd47"
print(f"Querying request_logs for account_id={account_id}...")

try:
    result = supabase.table("request_logs").select(
        "model, upstream_model, status, latency_ms, prompt_tokens, completion_tokens, total_tokens, created_at"
    ).eq("account_id", account_id).order("created_at", desc=True).limit(1000).execute()
    print("Success! Number of logs:", len(result.data or []))
    if result.data:
        print("First log sample:", result.data[0])
except Exception as e:
    print(f"Error querying request_logs: {e}")
