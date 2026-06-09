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
    
    # 1. Reset provider status to active for testing
    print("Resetting provider status to active...")
    supabase.table("providers").update({"health_status": "active"}).eq("account_label", "hermes-mq3hpeur").execute()
    
    # Fetch provider token
    res = supabase.table("providers").select("*").eq("account_label", "hermes-mq3hpeur").execute()
    if not res.data:
        print("Error: No provider found in DB.")
        sys.exit(1)
        
    provider = res.data[0]
    access_token = provider["access_token"]
    print(f"Using provider: {provider['account_label']}")
    print(f"Health status: {provider['health_status']}")
    print(f"Last error: {provider.get('last_error_msg')}")
    print(f"Access token prefix: {access_token[:20]}")
    
    # 2. Build direct request to Nous API with image
    image_url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAADklEQVR42mP8z8BQz0AEYBwKAEv5A9PzV+cQAAAABJRU5ErkJggg=="
    
    model = "stepfun/step-3.7-flash:free"
    print(f"\n--- Testing model: {model} with minimal payload ---")
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "What color is this image?"},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": image_url
                        }
                    }
                ]
            }
        ]
    }
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    url = "https://inference-api.nousresearch.com/v1/chat/completions"

    try:
        response = httpx.post(url, json=payload, headers=headers, timeout=30.0)
        print(f"Response status code: {response.status_code}")
        try:
            body = response.json()
            if response.status_code == 200:
                text = body["choices"][0]["message"].get("content")
                print(f"Success! Response: {text}")
            else:
                print(f"Failed with body: {body}")
        except Exception:
            print(f"Failed with raw text: {response.text}")
    except Exception as e:
        print(f"Request failed: {e}")

if __name__ == "__main__":
    run_test()
