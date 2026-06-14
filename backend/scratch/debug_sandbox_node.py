import os
import sys
from dotenv import load_dotenv

load_dotenv()
backend_dir = os.path.dirname(os.path.dirname(__file__))
sys.path.append(backend_dir)

from app.api.hosted_agents import decrypt_key
from app.core.supabase import get_supabase
from app.core.daytona import exec_command

sandbox_id = "bc215c4d-dbd6-48bf-8850-947838e37867"

# Fetch Daytona credentials
supabase = get_supabase()
res = supabase.table("daytona_keys").select("*").eq("key_label", "PRIMARY-DAYTONA-KEY").execute()
key_rec = res.data[0]
api_key = decrypt_key(key_rec["api_key_encrypted"])
api_url = key_rec["api_url"]

print(f"Finding 'n' command location and running node upgrade on sandbox {sandbox_id}...")

commands = [
    "which n",
    "find /usr -name n -type f 2>/dev/null",
    "sudo /usr/local/bin/n 22",
    "sudo /usr/local/share/npm-global/bin/n 22",
    "node -v",
]

for cmd in commands:
    print(f"\n--- Running: {cmd} ---")
    exit_code, output = exec_command(sandbox_id, cmd, api_key=api_key, api_url=api_url)
    print(f"Exit code: {exit_code}")
    print(f"Output: {output}")
