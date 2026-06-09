import os
import sys
from dotenv import load_dotenv

# Set python path to backend root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()

from fastapi.testclient import TestClient
from app.main import app
from app.core.supabase import get_supabase

def run_test():
    # Ensure provider is active
    supabase = get_supabase()
    supabase.table("providers").update({"health_status": "active"}).eq("account_label", "hermes-mq3hpeur").execute()

    client = TestClient(app)
    
    # We need to simulate API key auth by adding a valid token starting with "akar_"
    # Let's get a valid API key from the DB
    res = supabase.table("api_keys").select("*").eq("is_active", True).limit(1).execute()
    if not res.data:
        print("Error: No active API key found in DB to perform auth.")
        sys.exit(1)
        
    api_key_hash = res.data[0]["key_hash"]
    # We can use the actual API key from test_key.py
    API_KEY = "akar_Fnam8kmBmCLbf0EystiAi2zTiCWf9GZhsZs67BSPDds"
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

    # 1. Test streaming (stream=True) and custom params (top_p, stop, frequency_penalty)
    print("\n--- Test Case 1: Streaming response with custom OpenAI parameters ---")
    payload = {
        "model": "akarouter-pro",
        "messages": [
            {"role": "user", "content": "Tell me a short 1-sentence joke."}
        ],
        "stream": True,
        "temperature": 0.5,
        "top_p": 0.9,
        "frequency_penalty": 0.1,
        "stop": ["\n"]
    }
    
    # We use client.post with stream=True or read response line-by-line
    response = client.post("/v1/chat/completions", json=payload, headers=headers)
    print(f"Status Code: {response.status_code}")
    print(f"Content-Type: {response.headers.get('content-type')}")
    
    assert response.status_code == 200, "Streaming request failed"
    assert "text/event-stream" in response.headers.get("content-type", ""), "Response is not text/event-stream"
    
    # Read first few lines of stream
    lines = list(response.iter_lines())
    print(f"Received {len(lines)} lines from event stream.")
    print("Sample lines:")
    for line in lines[:10]:
        if line:
            print(f"  {line[:100]}")
            
    # 2. Test non-streaming (stream=False) with custom params
    print("\n--- Test Case 2: Non-streaming response with custom OpenAI parameters ---")
    payload = {
        "model": "akarouter-pro",
        "messages": [
            {"role": "user", "content": "Say 'hello world'"}
        ],
        "stream": False,
        "max_tokens": 10,
        "presence_penalty": 0.0
    }
    
    response = client.post("/v1/chat/completions", json=payload, headers=headers)
    print(f"Status Code: {response.status_code}")
    assert response.status_code == 200, "Non-streaming request failed"
    resp_json = response.json()
    print("Response Body:")
    print(resp_json)
    
    print("\n=== ALL OPENAI COMPATIBILITY TESTS PASSED SUCCESSFULLY ===")

if __name__ == "__main__":
    run_test()
