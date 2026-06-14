from unittest.mock import MagicMock, patch
import pytest

@pytest.mark.asyncio
@patch("app.core.cache.get_supabase")
async def test_flush_buffers_to_db_uses_rpcs(mock_get_supabase):
    import app.core.cache as cache
    
    # Seed buffers
    cache._account_usage_buffer = {
        "acc-1": {"monthly": 5, "total": 10}
    }
    cache._provider_usage_buffer = {
        "prov-1": {"requests": 15, "errors": 2}
    }
    cache._request_log_buffer = [
        {"id": "log-1", "cost": 0.05}
    ]
    
    mock_supabase = MagicMock()
    mock_get_supabase.return_value = mock_supabase
    
    await cache.flush_buffers_to_db()
    
    # Assert logs are batch inserted
    mock_supabase.table.assert_any_call("request_logs")
    mock_supabase.table().insert.assert_called_with([{"id": "log-1", "cost": 0.05}])
    
    # Assert atomic RPC updates are called
    mock_supabase.rpc.assert_any_call("increment_account_usage", {
        "p_account_id": "acc-1",
        "p_monthly_delta": 5,
        "p_total_delta": 10
    })
    mock_supabase.rpc.assert_any_call("increment_provider_stats", {
        "p_provider_id": "prov-1",
        "p_requests_delta": 15,
        "p_errors_delta": 2
    })
    
    # Verify buffers are cleared after flush
    assert len(cache._account_usage_buffer) == 0
    assert len(cache._provider_usage_buffer) == 0
    assert len(cache._request_log_buffer) == 0
