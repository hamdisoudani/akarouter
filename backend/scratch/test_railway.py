import httpx

def test():
    urls = [
        "http://akarouter-production.up.railway.app/v1/chat/completions",
        "https://akarouter-production.up.railway.app/v1/chat/completions",
        "http://akarouter-production.up.railway.app/",
        "https://akarouter-production.up.railway.app/"
    ]
    for url in urls:
        print(f"\n--- Testing {url} ---")
        try:
            # Test empty POST
            if "/v1/" in url:
                r = httpx.post(url, json={}, headers={"Authorization": "Bearer akar_invalid_key_test"}, timeout=10)
            else:
                r = httpx.get(url, timeout=10)
            print(f"Status Code: {r.status_code}")
            print(f"Headers: {dict(r.headers)}")
            print(f"Body: {r.text[:500]}")
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    test()
