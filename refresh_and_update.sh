#!/usr/bin/env python3
"""Refresh Nous OAuth token and update OpenClaw config."""
import json, os, sys, time

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from refresh_token import get_access_token, save_token, load_token

CONFIG_PATH = "/home/ubuntu/.openclaw/openclaw.json"

def main():
    try:
        token = get_access_token()
    except Exception as e:
        print(f"ERROR: Token refresh failed: {e}", file=sys.stderr)
        sys.exit(1)

    # Update openclaw.json
    try:
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)

        if "nous" not in cfg.get("models", {}).get("providers", {}):
            print("WARNING: nous provider not found in config, skipping config update")
        else:
            cfg["models"]["providers"]["nous"]["apiKey"] = token
            with open(CONFIG_PATH, "w") as f:
                json.dump(cfg, f, indent=2)
            print(f"OK: Config updated with fresh token ({token[:20]}...)")
    except Exception as e:
        print(f"ERROR: Config update failed: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
