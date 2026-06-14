import os
import sys
import json
import logging

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.daytona import exec_command, upload_openclaw_config, get_daytona_client
from app.api.hosted_agents import _resolve_daytona_credentials

logging.basicConfig(level=logging.INFO)

def apply():
    dtn_key, dtn_url = _resolve_daytona_credentials('89d89cbd-6098-47bf-af4f-e48055c24d4b')
    sandbox_id = 'bc215c4d-dbd6-48bf-8850-947838e37867'
    
    # Declare the model list properly
    config_dict = {
        "models": {
            "providers": {
                "akarouter": {
                    "baseUrl": "http://localhost:8000/v1",
                    "apiKey": "akar_DZmkI2BQDFsTAZX8kLXtFc4W-JQWwYwDYbCPC_4nMpM",
                    "api": "openai-completions",
                    "models": [
                        {"id": "akarouter-pro", "name": "AkaRouter Pro", "contextWindow": 128000},
                        {"id": "akarouter-flash", "name": "AkaRouter Flash", "contextWindow": 128000},
                        {"id": "akarouter-large", "name": "AkaRouter Large", "contextWindow": 128000}
                    ]
                }
            }
        },
        "agents": {
            "defaults": {
                "model": "akarouter/akarouter-pro",
                "workspace": "/home/node/.openclaw/workspace"
            },
            "list": [
                {
                    "id": "main",
                    "name": "AkaRouter Agent",
                    "identity": {
                        "name": "AkaRouter Agent",
                        "theme": "helpful assistant",
                        "emoji": "🤖"
                    }
                }
            ]
        },
        "channels": {}
    }
    
    # Upload config to home/node
    upload_openclaw_config(sandbox_id, config_dict, api_key=dtn_key, api_url=dtn_url)
    
    # Force copy/write to root as well since exec commands run as root
    config_json = json.dumps(config_dict, indent=2)
    exec_command(sandbox_id, "mkdir -p /root/.openclaw", api_key=dtn_key, api_url=dtn_url)
    # Upload directly via fs to root path
    client = get_daytona_client(dtn_key, dtn_url)
    sandbox = client.get(sandbox_id)
    sandbox.fs.upload_file(config_json.encode("utf-8"), "/root/.openclaw/openclaw.json")
    
    # Validate
    for cmd in [
        "openclaw config validate",
        "openclaw agents list"
    ]:
        print(f"\nRunning: {cmd}")
        code, out = exec_command(sandbox_id, cmd, api_key=dtn_key, api_url=dtn_url)
        print(f"Exit code: {code}")
        print(f"Output:\n{out}")

if __name__ == "__main__":
    apply()
