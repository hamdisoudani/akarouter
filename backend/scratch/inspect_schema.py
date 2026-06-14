import os
import sys
import json
import logging

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.daytona import exec_command
from app.api.hosted_agents import _resolve_daytona_credentials

logging.basicConfig(level=logging.INFO)

def inspect():
    dtn_key, dtn_url = _resolve_daytona_credentials('89d89cbd-6098-47bf-af4f-e48055c24d4b')
    code, out = exec_command('bc215c4d-dbd6-48bf-8850-947838e37867', 'openclaw config schema', api_key=dtn_key, api_url=dtn_url)
    
    if code != 0:
        print("Failed to run schema command")
        return
        
    try:
        schema = json.loads(out)
    except Exception as e:
        print(f"Failed to parse JSON: {e}")
        return
        
    # We want to extract specific sections from the root properties
    props = schema.get("properties", {})
    
    # 1. Models Provider schema
    models_schema = props.get("models", {})
    
    # 2. Agents schema
    agents_schema = props.get("agents", {})
    
    # 3. Channels schema
    channels_schema = props.get("channels", {})
    
    summary = {
        "models": models_schema,
        "agents": agents_schema,
        "channels": channels_schema
    }
    
    output_path = "scratch/schema_summary.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
        
    print(f"Summary written to {output_path}")

if __name__ == "__main__":
    inspect()
