import os
from dotenv import load_dotenv
from app.core.supabase import get_supabase

load_dotenv()
supabase = get_supabase()

try:
    # Update total_requests to match monthly_requests
    supabase.table("accounts").update({"total_requests": 6}).eq("id", "2a52540b-f572-493b-909b-5fb5c321dd47").execute()
    print("Updated total_requests to 6 successfully!")

    res = supabase.table("accounts").select("*").execute()
    print("Accounts columns and values:")
    for row in res.data:
        print(row)
        
    # Query request logs count
    res_logs = supabase.table("request_logs").select("id", count="exact").eq("account_id", "2a52540b-f572-493b-909b-5fb5c321dd47").execute()
    print(f"\nRequest Logs Count: {res_logs.count}")
    
    # Query actual logs
    res_logs_list = supabase.table("request_logs").select("created_at, model, status_code, latency_ms").eq("account_id", "2a52540b-f572-493b-909b-5fb5c321dd47").order("created_at", desc=True).execute()
    print("\nLogs:")
    for log in res_logs_list.data:
        print(log)
except Exception as e:
    print(f"Error checking: {e}")
