from unittest.mock import patch, MagicMock, AsyncMock, ANY
import pytest

@pytest.mark.asyncio
@patch("app.api.chat.get_supabase")
@patch("app.api.chat.get_http_client")
async def test_token_refresh_acquires_lock_successfully(mock_get_http_client, mock_get_supabase):
    from app.api.chat import _try_refresh
    
    provider = {
        "id": "provider-uuid",
        "refresh_token": "refresh-token-123",
        "access_token": "old-access-token"
    }
    
    mock_supabase = MagicMock()
    mock_get_supabase.return_value = mock_supabase
    
    # 1. Mock CAS update returning successfully (simulating lock acquired)
    mock_lock_res = MagicMock()
    mock_lock_res.data = [{"id": "provider-uuid"}] # row updated successfully
    mock_supabase.table().update().eq().or_().execute.return_value = mock_lock_res
    
    # 2. Mock HTTP POST call for refresh token endpoint
    mock_client = MagicMock()
    mock_get_http_client.return_value = mock_client
    
    mock_http_res = MagicMock()
    mock_http_res.status_code = 200
    mock_http_res.json.return_value = {
        "access_token": "new-access-token",
        "refresh_token": "new-refresh-token",
        "expires_in": 3600
    }
    mock_client.post = AsyncMock(return_value=mock_http_res)
    
    # 3. Mock provider updates
    mock_update_res = MagicMock()
    mock_update_res.data = [{"id": "provider-uuid"}]
    mock_supabase.table().update().eq().execute.return_value = mock_update_res
    
    refreshed = await _try_refresh(provider)
    
    assert refreshed is True
    assert provider["access_token"] == "new-access-token"
    assert provider["refresh_token"] == "new-refresh-token"
    
    # Assert DB update called
    mock_supabase.table("providers").update.assert_any_call({
        "access_token": "new-access-token",
        "refresh_token": "new-refresh-token",
        "token_expires_at": ANY,
        "refresh_lock_acquired_at": None
    })

@pytest.mark.asyncio
@patch("app.api.chat.get_supabase")
async def test_token_refresh_skips_when_lock_not_acquired(mock_get_supabase):
    from app.api.chat import _try_refresh
    
    provider = {
        "id": "provider-uuid",
        "refresh_token": "refresh-token-123",
        "access_token": "old-access-token"
    }
    
    mock_supabase = MagicMock()
    mock_get_supabase.return_value = mock_supabase
    
    # Mock CAS update returning empty data (lock NOT acquired since it's held by another request)
    mock_lock_res = MagicMock()
    mock_lock_res.data = [] # no row updated
    mock_supabase.table().update().eq().or_().execute.return_value = mock_lock_res
    
    refreshed = await _try_refresh(provider)
    
    assert refreshed is False
    assert provider["access_token"] == "old-access-token"  # Unchanged
