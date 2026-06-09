import os
import sys
from dotenv import load_dotenv

# Set python path to backend root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()

from fastapi.testclient import TestClient
from app.main import app

def run_test():
    client = TestClient(app)
    print("Testing GET /v1/models...")
    response = client.get("/v1/models")
    print(f"Status Code: {response.status_code}")
    print("Response JSON:")
    print(response.json())
    
    assert response.status_code == 200, "Models endpoint failed"
    data = response.json()["data"]
    
    # Check that capabilities are present
    pro_model = next((m for m in data if m["id"] == "akarouter-pro"), None)
    assert pro_model is not None, "akarouter-pro model missing"
    assert "capabilities" in pro_model, "capabilities field missing from model object"
    assert "image" in pro_model["capabilities"], "image capability missing from akarouter-pro"
    assert "video" in pro_model["capabilities"], "video capability missing from akarouter-pro"
    
    print("\n=== VERIFICATION SUCCESSFUL ===")

if __name__ == "__main__":
    run_test()
