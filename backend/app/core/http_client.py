"""Global HTTP Client for connection pooling."""
import httpx
from typing import Optional

_client: Optional[httpx.AsyncClient] = None


def get_http_client() -> httpx.AsyncClient:
    """Get the global AsyncClient. If not initialized, initialize and return a fallback client."""
    global _client
    if _client is None:
        # Fallback initialization if startup event didn't run (e.g., in test scripts or direct calls)
        _client = httpx.AsyncClient(
            timeout=120,
            http2=True,
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)
        )
    return _client


async def init_http_client() -> None:
    """Initialize the global AsyncClient on startup."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=120,
            http2=True,
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)
        )


async def close_http_client() -> None:
    """Close the global AsyncClient on shutdown."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
