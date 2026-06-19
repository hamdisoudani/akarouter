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


def _verify_supabase_jwt(token: str) -> dict | None:
    """Verify a Supabase JWT via Supabase Auth API and return user info with role, using local caching."""
    from app.core.cache import get_jwt_cache, set_jwt_cache
    
    # Try cache first
    cached_user = get_jwt_cache(token)
    if cached_user is not None:
        return cached_user

    try:
        supabase = get_supabase()
        # Retrieve user from token (validates the signature and session in real-time)
        user_resp = supabase.auth.get_user(token)
        if not user_resp or not getattr(user_resp, "user", None):
            logger.warning("Supabase Auth: failed to retrieve user from token")
            return None

        user = user_resp.user
        auth_user_id = user.id

        # Look up account in our DB
        account_resp = supabase.table("accounts").select("id, email, role, tier, status, suspended_reason, is_trialing").eq("auth_user_id", str(auth_user_id)).execute()
        if not account_resp.data:
            logger.warning("Supabase Auth: no user account found in DB for auth_user_id=%s", auth_user_id)
            return None
 
        account = account_resp.data[0]
        user_info = {
            "auth_user_id": str(auth_user_id),
            "account_id": account["id"],
            "email": account.get("email", user.email or ""),
            "role": account.get("role", "user"),
            "tier": account.get("tier", "free"),
            "status": account.get("status", "active"),
            "suspended_reason": account.get("suspended_reason") or "",
            "is_trialing": account.get("is_trialing", False),
        }
        # Cache verified user info (TTL 60 seconds)
        set_jwt_cache(token, user_info)
        return user_info
    except Exception as exc:
        logger.error("Supabase Auth: verification failed: %s", exc, exc_info=True)
        return None

