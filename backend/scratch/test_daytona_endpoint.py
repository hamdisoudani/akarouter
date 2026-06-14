import os
import sys
from dotenv import load_dotenv

# Load env variables
load_dotenv()

# Add backend directory to path
backend_dir = os.path.dirname(os.path.dirname(__file__))
sys.path.append(backend_dir)

from daytona import Daytona, DaytonaConfig

api_key = "dtn_92370861173ddc1416de27f8b79bb1c2d3925b1eba0d326e74fcb5dba54e68ae"
api_url = "https://app.daytona.io/api"

print(f"Testing Daytona API connection to {api_url}...")
try:
    config = DaytonaConfig(
        api_key=api_key,
        api_url=api_url,
        target="us"
    )
    client = Daytona(config)
    print("Initializing client...")
    sandboxes = client.list()
    print("Connection successful! Sandboxes in account:")
    print(sandboxes)
except Exception as e:
    print(f"Connection failed: {e}")
