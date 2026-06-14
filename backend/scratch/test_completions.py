import httpx
import json

def test():
    key = "akar_8aE4a9E3o2GtxUZAJ4tnVz4RAMwaBG4pZqbs5TtefAo"
    payload = {
        "model": "akarouter-flash",
        "messages": [{"role": "user", "content": "hi"}]
    }
    
    urls = [
        "http://akarouter-production.up.railway.app/v1/chat/completions",
        "https://akarouter-production.up.railway.app/v1/chat/completions"
    ]
    
    for url in urls:
        print(f"\n--- POST {url} ---")
        try:
            r = httpx.post(
                url,
                json=payload,
                headers={"Authorization": f"Bearer {key}"},
                timeout=15,
                follow_redirects=True
            )
            print(f"Status Code: {r.status_code}")
            print(f"Headers: {dict(r.headers)}")
            print(f"Body: {r.text[:500]}")
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    test()
