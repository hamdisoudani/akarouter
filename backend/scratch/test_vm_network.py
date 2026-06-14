import os
import sys
import logging

# Add backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.supabase import get_supabase
from app.core.daytona import exec_command
from app.api.hosted_agents import _resolve_daytona_credentials

def check_network():
    supabase = get_supabase()
    res = supabase.table("hosted_agents").select("*").eq("status", "running").execute()
    if not res.data:
        print("No running agents found in database.")
        return
        
    agent = res.data[0]
    sandbox_id = agent["sandbox_id"]
    daytona_key_id = agent.get("daytona_key_id")
    dtn_key, dtn_url = _resolve_daytona_credentials(daytona_key_id)
    
    print(f"Testing network for Agent {agent['agent_name']} (Sandbox: {sandbox_id})")
    
    commands = [
        "ping -c 3 8.8.8.8",
        "ping -c 3 google.com",
        "nslookup api.telegram.org",
        "curl -v -I https://www.google.com",
        "curl -v -I https://api.telegram.org"
    ]
    
    for cmd in commands:
        print(f"\n==========================================")
        print(f"Running: {cmd}")
        print(f"==========================================")
        try:
            code, out = exec_command(sandbox_id, cmd, timeout=20, api_key=dtn_key, api_url=dtn_url)
            print(f"Exit code: {code}")
            print(f"Output:\n{out}")
        except Exception as e:
            print(f"Command execution failed: {e}")

if __name__ == "__main__":
    check_network()
