import requests, time, random, string

URL = "http://localhost:8888/v1/chat/completions"
PAYLOAD = {"model": "stepfun/step-3.7-flash:free", "messages": [{"role":"user","content":"ping"}], "max_tokens": 5}

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    "Mozilla/5.0 (Android 14; Mobile) AppleWebKit/537.36",
    "curl/8.1.2", "python-requests/2.31.0", "Wget/1.24.5",
    "Apache-HttpClient/4.5.13", "HTTPie/3.2.2",
]

def make_headers():
    h = {"Content-Type": "application/json"}
    h["User-Agent"] = random.choice(USER_AGENTS)
    h["X-Request-ID"] = ''.join(random.choices(string.ascii_lowercase+string.digits, k=12))
    if random.random() > 0.5:
        h["Accept-Encoding"] = "gzip, deflate"
    if random.random() > 0.7:
        h["Accept"] = "application/json"
    return h

# Test 1: randomized headers, new session each request
print("=== Test 1: randomized headers + new session each request ===")
ok = 0; err = 0
for i in range(30):
    try:
        s = requests.Session()
        r = s.post(URL, json=PAYLOAD, headers=make_headers(), timeout=15)
        s.close()
        if r.status_code == 200: ok += 1
        else:
            err += 1
            print(f"  [{i}] HTTP {r.status_code}: {r.text[:120]}")
    except Exception as e:
        err += 1
        print(f"  [{i}] ERROR: {type(e).__name__}: {e}")
    time.sleep(random.uniform(0.1, 0.5))
print(f"ok={ok}, err={err}")

# Test 2: single session, randomized headers
print("\n=== Test 2: single session, randomized headers ===")
ok = 0; err = 0
s = requests.Session()
for i in range(30):
    try:
        r = s.post(URL, json=PAYLOAD, headers=make_headers(), timeout=15)
        if r.status_code == 200: ok += 1
        else:
            err += 1
            print(f"  [{i}] HTTP {r.status_code}: {r.text[:120]}")
    except Exception as e:
        err += 1
        print(f"  [{i}] ERROR: {type(e).__name__}: {e}")
    time.sleep(random.uniform(0.2, 0.8))
s.close()
print(f"ok={ok}, err={err}")

# Test 3: sequential no delay
print("\n=== Test 3: sequential no delay, same session ===")
ok = 0; err = 0
s = requests.Session()
for i in range(20):
    try:
        r = s.post(URL, json=PAYLOAD, headers={"Content-Type":"application/json"}, timeout=15)
        if r.status_code == 200: ok += 1
        else:
            err += 1
            print(f"  [{i}] HTTP {r.status_code}: {r.text[:120]}")
    except Exception as e:
        err += 1
        print(f"  [{i}] ERROR: {type(e).__name__}: {e}")
s.close()
print(f"ok={ok}, err={err}")

# Test 4: very slow requests
print("\n=== Test 4: 1 request per 2 seconds ===")
ok = 0; err = 0
for i in range(20):
    try:
        r = requests.post(URL, json=PAYLOAD, timeout=15)
        if r.status_code == 200: ok += 1
        else:
            err += 1
            print(f"  [{i}] HTTP {r.status_code}: {r.text[:120]}")
    except Exception as e:
        err += 1
        print(f"  [{i}] ERROR: {type(e).__name__}: {e}")
    time.sleep(2)
print(f"ok={ok}, err={err}")
