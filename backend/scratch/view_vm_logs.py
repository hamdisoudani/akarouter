import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.supabase import get_supabase
from app.core.daytona import exec_command, get_openclaw_logs
from app.api.hosted_agents import _resolve_daytona_credentials

def view_logs():
    supabase = get_supabase()
    res = supabase.table("hosted_agents").select("*").eq("status", "running").execute()
    if not res.data:
        print("No running agents found.")
        return
        
    agent = res.data[0]
    sandbox_id = agent["sandbox_id"]
    daytona_key_id = agent.get("daytona_key_id")
    dtn_key, dtn_url = _resolve_daytona_credentials(daytona_key_id)
    
    logs = get_openclaw_logs(sandbox_id, lines=50, api_key=dtn_key, api_url=dtn_url)
    print("--- LATEST RUNTIME LOGS ---")
    print(logs)

if __name__ == "__main__":
    view_logs()
