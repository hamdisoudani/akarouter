import time
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from fastapi.testclient import TestClient

@pytest.fixture
def mock_whop_settings():
    with patch("app.core.config.settings.whop_webhook_secret", "ws_secret"), \
         patch("app.core.config.settings.whop_plan_ultra", "plan-ultra-id"):
        yield

@patch("app.api.webhooks.get_supabase")
@patch("app.api.webhooks.get_http_client")
@patch("hmac.compare_digest")
def test_webhook_idempotency_skips_db_update(mock_compare_digest, mock_get_http_client, mock_get_supabase, mock_whop_settings):
    import sys
    import importlib
    if "app.main" in sys.modules:
        importlib.reload(sys.modules["app.main"])
    from app.main import app
    client = TestClient(app)
    
    # Bypass HMAC verification
    mock_compare_digest.return_value = True
    
    mock_supabase = MagicMock()
    mock_get_supabase.return_value = mock_supabase
    
    # 1. Mock memberships fetch returning ultra plan
    mock_client = MagicMock()
    mock_get_http_client.return_value = mock_client
    
    mock_http_res = MagicMock()
    mock_http_res.status_code = 200
    mock_http_res.json.return_value = {
        "data": [
            {
                "status": "active",
                "plan_id": "plan-ultra-id",
                "plan": {"id": "plan-ultra-id"}
            }
        ]
    }
    mock_client.get = AsyncMock(return_value=mock_http_res)
    
    # 2. Mock current database account state (already tier=ultra, limits matching)
    mock_curr_acc = MagicMock()
    mock_curr_acc.data = [{
        "tier": "ultra",
        "is_trialing": False,
        "monthly_limit": 100.0,
        "rpm_limit": 1000,
        "tokens_5h_limit": 10.0,
        "tokens_7d_limit": 50.0,
        "openclaw_enabled": True,
        "max_agents": 10,
        "agent_cpu": 2,
        "agent_ram": 2
    }]
    
    # 3. Mock plan presets query
    mock_preset_res = MagicMock()
    mock_preset_res.data = [{
        "tier": "ultra",
        "monthly_limit": 100.0,
        "rpm_limit": 1000,
        "tokens_5h_limit": 10.0,
        "tokens_7d_limit": 50.0,
        "openclaw_enabled": True,
        "max_agents": 10,
        "agent_cpu": 2,
        "agent_ram": 2
    }]
    
    # Define route mock response sequencing
    # Since metadata has account_id, account resolution select is skipped.
    # First select is for current_acc state, second is for plan presets
    mock_supabase.table().select().eq().execute.side_effect = [
        mock_curr_acc,                            # Idempotency check select
        mock_preset_res                           # Plan presets select
    ]
    
    # Send webhook
    response = client.post(
        "/v1/webhooks/whop",
        headers={
            "webhook-id": "test-webhook-id",
            "webhook-timestamp": str(int(time.time())),
            "webhook-signature": "v1,signature"
        },
        json={
            "type": "membership.activated",
            "data": {
                "metadata": {"account_id": "12345678-1234-5678-1234-567812345678"},
                "user": {"id": "whop-user-123", "email": "user@example.com"}
            }
        }
    )
    
    assert response.status_code == 200
    assert response.json()["status"] == "success"
    # Verify that the tier sync update was NOT executed (only the whop_user_id update is allowed)
    # So we check that update was not called with "tier" in the keys
    tier_updated = False
    for call in mock_supabase.table("accounts").update.call_args_list:
        args, kwargs = call
        payload = args[0] if args else kwargs.get("values", {})
        if "tier" in payload:
            tier_updated = True
            break
    assert not tier_updated, "Tier sync update was executed but should have been skipped by idempotency!"

@patch("app.api.webhooks.get_supabase")
@patch("app.api.webhooks.get_http_client")
@patch("hmac.compare_digest")
@pytest.mark.asyncio
async def test_webhook_db_writes_retried_on_failure(mock_compare_digest, mock_get_http_client, mock_get_supabase, mock_whop_settings):
    import sys
    import importlib
    if "app.main" in sys.modules:
        importlib.reload(sys.modules["app.main"])
    from app.main import app
    client = TestClient(app)
    
    # Bypass HMAC verification
    mock_compare_digest.return_value = True
    
    mock_supabase = MagicMock()
    mock_get_supabase.return_value = mock_supabase
    
    # 1. Mock memberships fetch returning ultra plan
    mock_client = MagicMock()
    mock_get_http_client.return_value = mock_client
    
    mock_http_res = MagicMock()
    mock_http_res.status_code = 200
    mock_http_res.json.return_value = {
        "data": [
            {
                "status": "active",
                "plan_id": "plan-ultra-id"
            }
        ]
    }
    mock_client.get = AsyncMock(return_value=mock_http_res)
    
    # 2. Mock current state (different tier to trigger update)
    mock_curr_acc = MagicMock()
    mock_curr_acc.data = [{"tier": "free"}] # different!
    
    mock_preset_res = MagicMock()
    mock_preset_res.data = [{
        "tier": "ultra",
        "monthly_limit": 100.0,
        "rpm_limit": 1000,
        "tokens_5h_limit": 10.0,
        "tokens_7d_limit": 50.0,
        "openclaw_enabled": True,
        "max_agents": 10,
        "agent_cpu": 2,
        "agent_ram": 2
    }]
    
    # Since metadata has account_id, account resolution select is skipped.
    # First select is for current_acc state, second is for plan presets
    mock_supabase.table().select().eq().execute.side_effect = [
        mock_curr_acc,                            # Idempotency check select
        mock_preset_res                           # Plan presets select
    ]
    
    # Sequence mock: First update of whop_user_id succeeds, subsequent updates for plan presets fail (DB Timeout)
    mock_update_executor = MagicMock()
    mock_update_executor.execute.side_effect = [
        MagicMock(data=[]),      # Success for whop_user_id update
        Exception("DB Timeout"), # Retry 1 for presets sync
        Exception("DB Timeout"), # Retry 2
        Exception("DB Timeout")  # Retry 3
    ]
    mock_supabase.table().update.return_value.eq.return_value = mock_update_executor
    
    # Send webhook with custom sleep patching to run test quickly
    with patch("asyncio.sleep", AsyncMock()) as mock_sleep:
        response = client.post(
            "/v1/webhooks/whop",
            headers={
                "webhook-id": "test-webhook-id",
                "webhook-timestamp": str(int(time.time())),
                "webhook-signature": "v1,signature"
            },
            json={
                "type": "membership.activated",
                "data": {
                    "metadata": {"account_id": "12345678-1234-5678-1234-567812345678"},
                    "user": {"id": "whop-user-123", "email": "user@example.com"}
                }
            }
        )
        
        # Verify it retried 3 times and returned a 500
        assert response.status_code == 500
        assert mock_update_executor.execute.call_count == 4  # 1 for whop_user_id + 3 retries for presets sync
