import concurrent.futures, requests, time, json

URL = "http://localhost:8888/v1/chat/completions"
HEADERS = {"Content-Type": "application/json"}
PAYLOAD = {
    "model": "stepfun/step-3.7-flash:free",
    "messages": [{"role": "user", "content": "ping"}],
    "max_tokens": 5,
}

results = {"ok": 0, "rate_limited": 0, "errors": 0, "times": []}

def request(i):
    try:
        t0 = time.time()
        r = requests.post(URL, headers=HEADERS, json=PAYLOAD, timeout=30)
        dt = time.time() - t0
        sc = r.status_code
        txt = r.text[:200]
        if sc == 200:
            return ("ok", dt, txt)
        elif sc == 429:
            return ("429", dt, txt)
        else:
            return (f"err_{sc}", dt, txt)
    except Exception as e:
        return ("exception", 0, str(e))

print(f"[+] Firing 120 concurrent requests...")
start = time.time()
with concurrent.futures.ThreadPoolExecutor(max_workers=120) as pool:
    futs = [pool.submit(request, i) for i in range(120)]
    for f in concurrent.futures.as_completed(futs):
        status, dt, txt = f.result()
        results["times"].append(dt)
        if status == "ok":
            results["ok"] += 1
        elif status == "429":
            results["rate_limited"] += 1
        else:
            results["errors"] += 1
            if results["errors"] <= 5:
                print(f"[error] {status}: {txt[:120]}")

elapsed = time.time() - start
results["elapsed"] = round(elapsed, 2)
results["min_latency"] = round(min(results["times"]), 2) if results["times"] else 0
results["max_latency"] = round(max(results["times"]), 2) if results["times"] else 0
results["avg_latency"] = round(sum(results["times"]) / len(results["times"]), 2) if results["times"] else 0

print("\n=== RESULTS ===")
for k, v in results.items():
    if k != "times":
        print(f"{k}: {v}")
