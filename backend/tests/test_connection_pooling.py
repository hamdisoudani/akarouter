import pytest
from app.core.http_client import get_http_client, init_http_client, close_http_client

@pytest.mark.asyncio
async def test_connection_pooling_same_instance():
    # Initialize http client pool
    await init_http_client()
    
    client1 = get_http_client()
    client2 = get_http_client()
    
    # Assert they are the exact same instance in memory (singleton)
    assert client1 is client2
    assert not client1.is_closed
    
    # Clean up
    await close_http_client()
    assert get_http_client() is not client1  # After close, calling get_http_client creates a new fallback client
