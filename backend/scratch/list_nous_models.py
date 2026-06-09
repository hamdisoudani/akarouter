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
    
    headers = {
        "Authorization": f"Bearer {access_token}",
    }
    
    url = "https://inference-api.nousresearch.com/v1/models"
    try:
        response = httpx.get(url, headers=headers, timeout=30.0)
        print(f"Status Code: {response.status_code}")
        models_data = response.json()
        print("Free Models:")
        for model in models_data.get("data", []):
            model_id = model['id']
            if "free" in model_id:
                print(f"- {model_id}")
    except Exception as e:
        print(f"Request failed: {e}")

if __name__ == "__main__":
    run_test()
