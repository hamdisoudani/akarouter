from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient

@patch("app.api.user.get_supabase")
@patch("app.core.supabase._verify_supabase_jwt")
def test_get_my_analytics_with_date_filters(mock_verify_jwt, mock_get_supabase):
    from app.main import app
    client = TestClient(app)
    
    # Mock auth jwt
    mock_verify_jwt.return_value = {
        "account_id": "acc-uuid-123",
        "email": "user@example.com",
        "role": "user",
        "tier": "free",
        "status": "active"
    }
    
    mock_supabase = MagicMock()
    mock_get_supabase.return_value = mock_supabase
    
    # Mock request logs response
    mock_logs_res = MagicMock()
    mock_logs_res.data = [
        {
            "model": "akarouter-pro",
            "upstream_model": "stepfun/step-3.7-flash:free",
            "status_code": 200,
            "latency_ms": 250,
            "prompt_tokens": 100,
            "completion_tokens": 50,
            "total_tokens": 150,
            "created_at": "2026-06-10T12:00:00Z"
        }
    ]
    
    # Set up method cascading mock
    # query chain: supabase.table().select().eq().gte().lte().order().limit().execute()
    mock_query = mock_supabase.table().select().eq()
    mock_query.gte.return_value = mock_query
    mock_query.lte.return_value = mock_query
    mock_query.order().limit().execute.return_value = mock_logs_res
    
    response = client.get(
        "/user/analytics",
        headers={"Authorization": "Bearer eyJtest"},
        params={
            "days": 15,
            "start_date": "2026-06-01T00:00:00Z",
            "end_date": "2026-06-15T00:00:00Z"
        }
    )
    
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["total_logs"] == 1
    assert len(res_data["models"]) == 1
    assert res_data["models"][0]["model"] == "akarouter-pro"
    
    # Assert correct filters are applied on the query chain
    mock_query.gte.assert_called_with("created_at", "2026-06-01T00:00:00Z")
    mock_query.lte.assert_called_with("created_at", "2026-06-15T00:00:00Z")
