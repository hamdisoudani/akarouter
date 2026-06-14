from unittest.mock import patch, MagicMock
import pytest

@pytest.mark.asyncio
@patch("app.core.router.get_model_metadata")
@patch("app.core.router.buffer_request_log")
@patch("app.core.router.buffer_account_usage")
@patch("app.core.router.increment_account_budget")
async def test_log_request_success_bills_user(
    mock_inc_budget, mock_buf_usage, mock_buf_log, mock_get_metadata
):
    from app.core.router import log_request
    
    mock_get_metadata.return_value = {
        "input_cost_per_million": 0.10,
        "output_cost_per_million": 0.30
    }
    
    await log_request(
        account_id="acc-123",
        api_key_id="key-123",
        provider_id="prov-123",
        model="akarouter-flash",
        upstream_model="nvidia/nemotron-3-ultra:free",
        status_code=200,
        latency_ms=150,
        prompt_tokens=1000000,      # 1M tokens
        completion_tokens=1000000,  # 1M tokens
    )
    
    # Check that it calculates correct cost (1.0M * 0.10 + 1.0M * 0.30 = 0.40)
    mock_buf_log.assert_called_once()
    log_data = mock_buf_log.call_args[0][0]
    assert log_data["cost"] == pytest.approx(0.40)
    
    # Successful request increments budget & usage
    mock_buf_usage.assert_called_once_with("acc-123")
    mock_inc_budget.assert_called_once_with("acc-123", pytest.approx(0.40))


@pytest.mark.asyncio
@patch("app.core.router.get_model_metadata")
@patch("app.core.router.buffer_request_log")
@patch("app.core.router.buffer_account_usage")
@patch("app.core.router.increment_account_budget")
async def test_log_request_error_does_not_bill_user(
    mock_inc_budget, mock_buf_usage, mock_buf_log, mock_get_metadata
):
    from app.core.router import log_request
    
    await log_request(
        account_id="acc-123",
        api_key_id="key-123",
        provider_id="prov-123",
        model="akarouter-flash",
        upstream_model="nvidia/nemotron-3-ultra:free",
        status_code=500,  # Error response!
        latency_ms=150,
        prompt_tokens=1000000,
        completion_tokens=1000000,
    )
    
    # Cost should be 0.0 in log
    mock_buf_log.assert_called_once()
    log_data = mock_buf_log.call_args[0][0]
    assert log_data["cost"] == 0.0
    
    # Should NOT increment budget or usage
    mock_buf_usage.assert_not_called()
    mock_inc_budget.assert_not_called()
