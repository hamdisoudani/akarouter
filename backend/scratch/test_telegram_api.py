import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.supabase import get_supabase
from app.core.daytona import exec_command
from app.api.hosted_agents import _resolve_daytona_credentials

def check_telegram():
    supabase = get_supabase()
    res = supabase.table("hosted_agents").select("*").eq("status", "running").execute()
    if not res.data:
        print("No running agents found.")
        return
        
    agent = res.data[0]
    sandbox_id = agent["sandbox_id"]
    daytona_key_id = agent.get("daytona_key_id")
    dtn_key, dtn_url = _resolve_daytona_credentials(daytona_key_id)
    
    # Run curl to getMe
    cmd = "curl -v https://api.telegram.org/bot8671027982:AAF5fiq522e2I_D7zhX0d6bfA1z6aeUhgsk/getMe"
    print(f"Running: {cmd}")
    code, out = exec_command(sandbox_id, cmd, timeout=20, api_key=dtn_key, api_url=dtn_url)
    print(f"Exit code: {code}")
    print(f"Output:\n{out}")

if __name__ == "__main__":
    check_telegram()
