import sys
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

@patch("app.main._verify_supabase_jwt")
def test_auth_middleware_no_token_leak_to_stdout(mock_verify_jwt, capsys):
    from app.main import app
    
    mock_verify_jwt.return_value = {
        "account_id": "test-uuid",
        "email": "user@example.com",
        "role": "user",
        "tier": "free",
        "status": "active"
    }
    
    client = TestClient(app)
    # Perform an authenticated request
    secret_jwt_token = "eyJSECRET_JWT_TOKEN_THAT_SHOULD_NEVER_BE_LOGGED"
    response = client.get(
        "/user/me",
        headers={"Authorization": f"Bearer {secret_jwt_token}"}
    )
    
    # Capture standard output and error logs
    captured = capsys.readouterr()
    
    # Ensure standard output does not contain the debug prints or the token
    assert "MIDDLEWARE_DEBUG" not in captured.out
    assert "eyJSECRET_JWT" not in captured.out
    assert response.status_code == 200
