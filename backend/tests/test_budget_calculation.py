import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

@pytest.mark.asyncio
@patch("app.core.cache.get_supabase")
async def test_calculate_account_budget_from_db_and_buffer(mock_get_supabase):
    from app.core.cache import calculate_account_budget, _request_log_buffer
    
    account_id = "test-account"
    budget_reset_at = "2026-06-01T00:00:00Z"
    
    mock_supabase = MagicMock()
    mock_get_supabase.return_value = mock_supabase
    
    # Mock DB RPC returning database totals
    mock_rpc_res = MagicMock()
    mock_rpc_res.data = [{
        "consumed_5h": 0.10,
        "consumed_7d": 0.50,
        "consumed_month": 1.50
    }]
    mock_supabase.rpc().execute.return_value = mock_rpc_res
    
    # Mock in-memory buffer with an unflushed log for the same account
    now_str = datetime.now(timezone.utc).isoformat()
    _request_log_buffer.clear()
    _request_log_buffer.append({
        "account_id": account_id,
        "cost": 0.05,
        "created_at": now_str
    })
    
    budget = await calculate_account_budget(account_id, budget_reset_at)
    
    # Assert values: DB value + buffered value
    assert budget["consumed_5h"] == pytest.approx(0.15)
    assert budget["consumed_7d"] == pytest.approx(0.55)
    assert budget["consumed_month"] == pytest.approx(1.55)
    
    # Clean up buffer
    _request_log_buffer.clear()
