import os
import sys
import asyncio
from fastapi import Request
from pydantic import BaseModel

# Add backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.supabase import get_supabase
from app.api.hosted_agents import configure_channels, ConfigureChannelsRequest

class MockState:
    def __init__(self, supabase_user):
        self.supabase_user = supabase_user
        self.auth = None

class MockRequest:
    def __init__(self, account_id, base_url="http://localhost:8000"):
        self.state = MockState({"account_id": account_id, "email": "test@example.com", "role": "user"})
        self.base_url = base_url

async def run_test():
    supabase = get_supabase()
    
    # Fetch agent and its account_id
    res = supabase.table("hosted_agents").select("*").eq("sandbox_id", "bc215c4d-dbd6-48bf-8850-947838e37867").execute()
    agents = res.data or []
    if not agents:
        print("No agent found for sandbox bc215c4d-dbd6-48bf-8850-947838e37867")
        return
        
    agent = agents[0]
    agent_id = agent["id"]
    account_id = agent["account_id"]
    
    print(f"Triggering configure_channels for Agent ID: {agent_id}, Account ID: {account_id}")
    
    # Mock request
    req = MockRequest(account_id)
    
    # Build payload
    body = ConfigureChannelsRequest(
        telegram_enabled=True,
        telegram_bot_token="789012345:AAH_dummy_token_for_telegram_bot_abc123",
        telegram_allow_from="123456789, 987654321",
        discord_enabled=False
    )
    
    try:
        response = await configure_channels(agent_id=agent_id, request=req, body=body)
        print("Response:", response)
    except Exception as e:
        print("Error calling configure_channels:", e)

if __name__ == "__main__":
    asyncio.run(run_test())
