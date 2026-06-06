import requests, time

URL = "http://localhost:8888/v1/chat/completions"
PAYLOAD = {"model": "stepfun/step-3.7-flash:free", "messages": [{"role":"user","content":"ping"}], "max_tokens": 5}

def send_batch(batch_size):
    ok = 0
    for i in range(batch_size):
        try:
            r = requests.post(URL, json=PAYLOAD, timeout=20)
            if r.status_code == 200:
                ok += 1
            else:
                print(f"  [{i}] HTTP {r.status_code}: {r.text[:120]}")
        except Exception as e:
            print(f"  [{i}] ERROR: {e}")
    return ok

total = 0
print("=== sending 8/s rapid burst ===")
ok = send_batch(8)
total += ok
print(f"  batch ok={ok}, total={total}")

print("=== sending 8/s rapid burst 2 ===")
ok = send_batch(8)
total += ok
print(f"  batch ok={ok}, total={total}")

print("=== sending 10/s ===")
ok = send_batch(10)
total += ok
print(f"  batch ok={ok}, total={total}")

print("=== sending 15/s ===")
ok = send_batch(15)
total += ok
print(f"  batch ok={ok}, total={total}")

print("=== sending 20/s ===")
ok = send_batch(20)
total += ok
print(f"  batch ok={ok}, total={total}")

print(f"\nFINAL total_ok={total}")
print("waiting 10s then sending final probe...")
time.sleep(10)
try:
    r = requests.post(URL, json=PAYLOAD, timeout=20)
    print(f"probe: HTTP {r.status_code}")
except Exception as e:
    print(f"probe ERROR: {e}")
