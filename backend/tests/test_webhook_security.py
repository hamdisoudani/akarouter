import time
import pytest
from fastapi.testclient import TestClient

def test_webhook_stale_timestamp_rejected():
    from app.main import app
    client = TestClient(app)
    
    # Send a webhook request with a timestamp older than 5 minutes (300s)
    stale_timestamp = int(time.time()) - 360
    
    response = client.post(
        "/v1/webhooks/whop",
        headers={
            "webhook-id": "test-id",
            "webhook-timestamp": str(stale_timestamp),
            "webhook-signature": "v1,signature"
        },
        json={"type": "membership.activated"}
    )
    
    assert response.status_code == 401
    assert "Webhook timestamp too old" in response.json()["detail"]

def test_webhook_missing_headers_rejected():
    from app.main import app
    client = TestClient(app)
    
    response = client.post(
        "/v1/webhooks/whop",
        json={"type": "membership.activated"}
    )
    
    assert response.status_code == 401
    assert "Missing signature headers" in response.json()["detail"]
