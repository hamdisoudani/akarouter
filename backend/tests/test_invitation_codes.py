from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from fastapi.testclient import TestClient

# Mock reCAPTCHA verification in app.api.user to always succeed
@pytest.fixture(autouse=True)
def mock_recaptcha():
    with patch("app.api.user.verify_recaptcha", AsyncMock(return_value=True)):
        yield

@patch("app.api.user.get_supabase")
@patch("app.main._verify_supabase_jwt")
def test_activate_account_success(mock_verify_jwt, mock_get_supabase):
    from app.main import app
    
    # Mock authentication with valid UUID
    mock_verify_jwt.return_value = {
        "account_id": "12345678-1234-5678-1234-567812345678",
        "email": "user@example.com",
        "role": "user",
        "tier": "free",
        "status": "pending",
    }
    
    # Mock Supabase table check on accounts
    mock_supabase = MagicMock()
    mock_get_supabase.return_value = mock_supabase
    
    mock_acc_res = MagicMock()
    mock_acc_res.data = [{"status": "pending"}]
    mock_supabase.table().select().eq().execute.return_value = mock_acc_res
    
    # Mock Supabase claim_invitation_code RPC call returning success
    mock_claim_res = MagicMock()
    mock_claim_res.data = True
    mock_supabase.rpc().execute.return_value = mock_claim_res
    
    # Execute request
    client = TestClient(app)
    response = client.post(
        "/user/activate",
        headers={"Authorization": "Bearer eyJtest"},
        json={"code": "VALIDCODE", "recaptcha_token": "recaptcha-ok"}
    )
    
    assert response.status_code == 200
    assert response.json() == {"ok": True, "message": "Account activated successfully"}
    mock_supabase.rpc.assert_called_with("claim_invitation_code", {
        "p_code": "VALIDCODE",
        "p_account_id": "12345678-1234-5678-1234-567812345678"
    })

@patch("app.api.user.get_supabase")
@patch("app.main._verify_supabase_jwt")
def test_activate_account_failure(mock_verify_jwt, mock_get_supabase):
    from app.main import app
    
    # Mock authentication with valid UUID
    mock_verify_jwt.return_value = {
        "account_id": "12345678-1234-5678-1234-567812345678",
        "email": "user@example.com",
        "role": "user",
        "tier": "free",
        "status": "pending",
    }
    
    mock_supabase = MagicMock()
    mock_get_supabase.return_value = mock_supabase
    
    mock_acc_res = MagicMock()
    mock_acc_res.data = [{"status": "pending"}]
    mock_supabase.table().select().eq().execute.return_value = mock_acc_res
    
    # Mock Supabase claim_invitation_code RPC call returning failure (code invalid/expired/used up)
    mock_claim_res = MagicMock()
    mock_claim_res.data = False
    mock_supabase.rpc().execute.return_value = mock_claim_res
    
    client = TestClient(app)
    response = client.post(
        "/user/activate",
        headers={"Authorization": "Bearer eyJtest"},
        json={"code": "INVALIDCODE", "recaptcha_token": "recaptcha-ok"}
    )
    
    assert response.status_code == 400
    assert "Invalid or inactive invitation code" in response.json()["detail"]
