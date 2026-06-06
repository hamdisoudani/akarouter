"""Supabase client for AKAROUTER backend."""
import logging
from supabase import create_client, Client
from app.core.config import settings

logger = logging.getLogger(__name__)

_client: Client | None = None


def get_supabase() -> Client:
    """Get or create the Supabase client (service role)."""
    global _client
    if _client is not None:
        return _client
    if not settings.supabase_configured:
        raise RuntimeError("Supabase credentials are not configured")
    _client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    logger.info("Supabase client initialized (service role)")
    return _client


def reset_supabase() -> None:
    """Reset the client (used after config changes)."""
    global _client
    _client = None
