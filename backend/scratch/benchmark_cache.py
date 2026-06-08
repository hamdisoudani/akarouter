import os
import time
import asyncio
from dotenv import load_dotenv
from app.core.router import authenticate_api_key

load_dotenv()
API_KEY = "akar_Fnam8kmBmCLbf0EystiAi2zTiCWf9GZhsZs67BSPDds"

async def run_benchmark():
    print("\n--- BENCHMARKING CACHE PERFORMANCE ---")
    print("Performing API Key authentications...")
    
    # 1. First call (cache miss, queries Supabase)
    start = time.perf_counter()
    res1 = await authenticate_api_key(API_KEY)
    duration_miss = (time.perf_counter() - start) * 1000
    assert res1 is not None, "API Key authentication failed!"
    print(f"1st Call (Cache Miss / DB Query): {duration_miss:.4f} ms")

    # 2. Subsequent calls (cache hit, served from memory)
    latencies = []
    for i in range(5):
        start = time.perf_counter()
        await authenticate_api_key(API_KEY)
        latencies.append((time.perf_counter() - start) * 1000)
    
    avg_hit = sum(latencies) / len(latencies)
    print(f"Subsequent 5 Calls (Cache Hits - Average): {avg_hit:.6f} ms")
    
    # Avoid zero division
    denominator = max(avg_hit, 0.000001)
    speedup = duration_miss / denominator
    print(f"\n[CACHE SUCCESS] Memory cache speedup: {speedup:.1f}x faster!")

if __name__ == "__main__":
    asyncio.run(run_benchmark())
