import os
import sys
import httpx
import json
from dotenv import load_dotenv

# Set python path to backend root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()

from app.core.supabase import get_supabase

def run_test():
    supabase = get_supabase()
    res = supabase.table("providers").select("*").eq("account_label", "hermes-mq3hpeur").execute()
    if not res.data:
        print("Error: No provider found in DB.")
        sys.exit(1)
        
    provider = res.data[0]
    access_token = provider["access_token"]
    
    payload = {
        "model": "stepfun/step-3.7-flash:free",
        "messages": [
            {
                "role": "user",
                "content": "Hello! What is your name?"
            }
        ],
        "max_tokens": 100
    }
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    url = "https://inference-api.nousresearch.com/v1/chat/completions"
    
    try:
        response = httpx.post(url, json=payload, headers=headers, timeout=60.0)
        print(f"Response status code: {response.status_code}")
        print("Response body:")
        try:
            print(json.dumps(response.json(), indent=2))
        except Exception:
            print(response.text)
    except Exception as e:
        print(f"Request failed: {e}")

if __name__ == "__main__":
    run_test()
