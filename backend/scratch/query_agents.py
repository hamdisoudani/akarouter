import os
import sys
from dotenv import load_dotenv

# Ensure backend directory is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.supabase import get_supabase

# Load env
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

supabase = get_supabase()

def query():
    print("--- HOSTED AGENTS ---")
    res = supabase.table("hosted_agents").select("*").execute()
    for row in res.data:
        print(f"ID: {row['id']}")
        print(f"  Name: {row['agent_name']}")
        print(f"  Status: {row['status']}")
        print(f"  Sandbox ID: {row['sandbox_id']}")
        print(f"  Model Name: {row['model_name']}")
        print(f"  Error Message: {row['error_message']}")
        progress_msg = str(row['progress_message']).encode('ascii', errors='ignore').decode('ascii') if row['progress_message'] else "None"
        print(f"  Progress Message: {progress_msg}")
        print(f"  Daytona Key ID: {row['daytona_key_id']}")
        print("-" * 40)
        
    print("\n--- ACTIVE PROVIDERS ---")
    res_prov = supabase.table("providers").select("*").execute()
    for p in res_prov.data:
        print(f"ID: {p['id']}")
        print(f"  Label: {p['account_label']}")
        print(f"  Status: {p['health_status']}")
        print(f"  Access Token: {p['access_token'][:15]}..." if p['access_token'] else "  Access Token: None")
        print("-" * 40)

    print("\n--- MODEL MAPPING IN DB ---")
    res_models = supabase.table("model_mapping").select("*").execute()
    for m in res_models.data:
        print(f"Alias: {m['alias']}")
        print(f"  Upstream Model: {m.get('upstream_model')}")
        print(f"  Display Name: {m.get('display_name')}")
        print(f"  Is Active: {m.get('is_active')}")
        print("-" * 40)

if __name__ == "__main__":
    query()
