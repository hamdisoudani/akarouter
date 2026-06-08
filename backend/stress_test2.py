import concurrent.futures, requests, time

URL = "http://localhost:8888/v1/chat/completions"
HEADERS = {"Content-Type": "application/json"}
PAYLOAD = {"model": "stepfun/step-3.7-flash:free", "messages": [{"role":"user","content":"ping"}], "max_tokens": 5}

def test_concurrency(workers, total=60):
    results = {"ok": 0, "429": 0, "reset": 0, "other_err": 0}
    def req(i):
        try:
            r = requests.post(URL, json=PAYLOAD, timeout=15)
            sc = r.status_code
            if sc == 200: return "ok"
            if sc == 429: return "429"
            return f"err_{sc}"
        except requests.exceptions.ConnectionError:
            return "reset"
        except Exception as e:
            return "other_err"
    t0 = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futs = [pool.submit(req, i) for i in range(total)]
        for f in concurrent.futures.as_completed(futs):
            r = f.result()
            results[r] = results.get(r, 0) + 1
    return round(time.time() - t0, 2), results

for w in [5, 10, 16, 20, 25, 30, 50]:
    t, res = test_concurrency(w, 60)
    print(f"workers={w:2d}: {res} in {t}s")
