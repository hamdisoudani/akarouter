import os
import sys
from dotenv import load_dotenv

# Load env variables
load_dotenv()

# Add backend directory to path to allow importing app modules
backend_dir = os.path.dirname(os.path.dirname(__file__))
sys.path.append(backend_dir)

from app.api.hosted_agents import encrypt_key
from app.core.supabase import get_supabase

raw_key = "dtn_92370861173ddc1416de27f8b79bb1c2d3925b1eba0d326e74fcb5dba54e68ae"
encrypted_key = encrypt_key(raw_key)

print(f"Encrypting Daytona API Key...")
supabase = get_supabase()

try:
    # Check if a key with this label already exists
    check_res = supabase.table("daytona_keys").select("id").eq("key_label", "PRIMARY-DAYTONA-KEY").execute()
    if check_res.data:
        print("PRIMARY-DAYTONA-KEY already exists. Updating it...")
        res = supabase.table("daytona_keys").update({
            "api_key_encrypted": encrypted_key,
            "api_url": "https://app.daytona.io",
            "is_active": True
        }).eq("key_label", "PRIMARY-DAYTONA-KEY").execute()
    else:
        print("Inserting new PRIMARY-DAYTONA-KEY...")
        res = supabase.table("daytona_keys").insert({
            "key_label": "PRIMARY-DAYTONA-KEY",
            "api_key_encrypted": encrypted_key,
            "api_url": "https://app.daytona.io",
            "is_active": True
        }).execute()
        
    print("Success! DB entry:", res.data)
except Exception as e:
    print(f"Failed to register key in database: {e}")
