import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase = create_client(os.environ['AKAROUTER_SUPABASE_URL'], os.environ['AKAROUTER_SUPABASE_SERVICE_ROLE_KEY'])

cols = [
    "account_id",
    "api_key_id",
    "provider_id",
    "model",
    "upstream_model",
    "endpoint",
    "method",
    "status_code",
    "latency_ms",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "error_message",
    "ip_address",
    "user_agent",
    "created_at"
]

for col in cols:
    try:
        supabase.table("request_logs").select(col).limit(1).execute()
        print(f"Column '{col}' exists")
    except Exception as e:
        print(f"Column '{col}' ERROR: {e}")
