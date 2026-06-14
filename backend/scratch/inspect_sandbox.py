import os
import sys
import json
import logging

# Add backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.config import settings
from app.core.supabase import get_supabase
from app.core.daytona import get_daytona_client, exec_command
from app.api.hosted_agents import decrypt_key, _resolve_daytona_credentials

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("inspect_sandbox")

def inspect():
    supabase = get_supabase()
    # Fetch all hosted agents
    res = supabase.table("hosted_agents").select("*").execute()
    agents = res.data or []
    print(f"Found {len(agents)} hosted agents:")
    for agent in agents:
        print(f"ID: {agent['id']}, Name: {agent['agent_name']}, Status: {agent['status']}, Sandbox ID: {agent['sandbox_id']}")
        
        if not agent['sandbox_id']:
            continue
            
        print("\n--- Sandbox Details ---")
        daytona_key_id = agent.get("daytona_key_id")
        dtn_key, dtn_url = _resolve_daytona_credentials(daytona_key_id)
        
        print(f"Daytona Key ID: {daytona_key_id}")
        print(f"Daytona Base URL: {dtn_url}")
        
        # Test basic commands
        for cmd in [
            "node -v",
            "npm -v",
            "which openclaw",
            "openclaw -v",
            "ls -la /home/node/.openclaw/",
            "cat /home/node/.openclaw/openclaw.json",
            "tail -n 30 /tmp/openclaw.log"
        ]:
            print(f"\nRunning: {cmd}")
            try:
                code, out = exec_command(agent['sandbox_id'], cmd, timeout=10, api_key=dtn_key, api_url=dtn_url)
                print(f"Exit code: {code}")
                print(f"Output:\n{out}")
            except Exception as e:
                print(f"Error executing command: {e}")

if __name__ == "__main__":
    inspect()
