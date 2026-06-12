"""AKAROUTER Whop webhooks router."""
import json
import hmac
import hashlib
import logging
from datetime import datetime, timezone
import httpx
from fastapi import APIRouter, Request, Header, HTTPException

from app.core.config import settings
from app.core.supabase import get_supabase
from app.core.cache import evict_account_caches

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/v1/webhooks/whop")
async def whop_webhook_handler(
    request: Request,
    x_whop_signature: str = Header(None),
    webhook_signature: str = Header(None)
):
    """
    Handle incoming Whop webhooks to sync subscriptions.
    """
    signature = x_whop_signature or webhook_signature
    if not signature:
        logger.warning("Whop webhook rejected: Missing signature header")
        raise HTTPException(status_code=401, detail="Missing signature header")

    payload_bytes = await request.body()

    # Verify Whop Webhook Signature
    if not settings.whop_webhook_secret:
        logger.error("Whop webhook secret is not configured in settings")
        raise HTTPException(status_code=500, detail="Webhook configuration error")

    expected_signature = hmac.new(
        key=settings.whop_webhook_secret.encode("utf-8"),
        msg=payload_bytes,
        digestmod=hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected_signature, signature):
        logger.warning("Whop webhook rejected: Invalid signature")
        raise HTTPException(status_code=401, detail="Invalid signature")

    # Parse payload
    try:
        event = json.loads(payload_bytes.decode("utf-8"))
    except Exception as e:
        logger.error(f"Failed to parse Whop webhook JSON payload: {e}")
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    event_name = event.get("type") or event.get("action")
    logger.info(f"Received verified Whop webhook: {event_name}")

    # Handle membership activated/deactivated events
    supported_events = {
        "membership.activated", "membership_activated", "membership.went_valid",
        "membership.deactivated", "membership_deactivated", "membership.went_invalid"
    }

    if event_name not in supported_events:
        logger.info(f"Ignored unsupported Whop webhook event: {event_name}")
        return {"status": "ignored", "reason": "unsupported_event"}

    data = event.get("data", {})
    metadata = data.get("metadata", {}) or {}
    account_id = metadata.get("account_id")

    whop_user = data.get("user", {}) or {}
    whop_user_id = whop_user.get("id")

    supabase = get_supabase()

    # Resilient resolution of account_id
    if not account_id:
        if whop_user_id:
            # Look up account by whop_user_id in DB
            db_res = supabase.table("accounts").select("id").eq("whop_user_id", whop_user_id).execute()
            if db_res.data:
                account_id = db_res.data[0]["id"]
                logger.info(f"Resolved account_id {account_id} via whop_user_id: {whop_user_id}")

        if not account_id and whop_user.get("email"):
            # Fallback to email
            email = whop_user.get("email")
            db_res = supabase.table("accounts").select("id").eq("email", email).execute()
            if db_res.data:
                account_id = db_res.data[0]["id"]
                logger.info(f"Resolved account_id {account_id} via email: {email}")

    if not account_id:
        logger.warning(f"Could not resolve account_id for Whop event: {event_name} (user_id: {whop_user_id})")
        return {"status": "ignored", "reason": "could_not_resolve_account"}

    import uuid
    try:
        uuid.UUID(str(account_id))
    except ValueError:
        logger.warning(f"Whop webhook resolved account_id is not a valid UUID: {account_id}")
        return {"status": "ignored", "reason": "invalid_account_id_format"}

    # Update whop_user_id on account to bind them for future calls
    if whop_user_id:
        try:
            supabase.table("accounts").update({"whop_user_id": whop_user_id}).eq("id", account_id).execute()
        except Exception as e:
            logger.error(f"Failed to update whop_user_id on account {account_id}: {e}")

    # Call GET memberships to avoid race conditions and fetch true active tiers
    active_tier = "free"
    is_trialing = False
    if whop_user_id:
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(
                    "https://api.whop.com/v1/memberships",
                    headers={"Authorization": f"Bearer {settings.whop_api_key}"},
                    params={
                        "company_id": settings.whop_company_id,
                        "user_ids[]": [whop_user_id]
                    },
                    timeout=10.0
                )
                if res.status_code == 200:
                    memberships_data = res.json().get("data", [])
                    active_memberships = [
                        m for m in memberships_data
                        if m.get("status") in ("active", "trialing")
                    ]
                    
                    is_trialing = any(m.get("status") == "trialing" for m in active_memberships)
                    
                    highest_rank = 0
                    for m in active_memberships:
                        plan_id = m.get("plan", {}).get("id") or m.get("plan_id")
                        product_id = m.get("product", {}).get("id") or m.get("product_id")
                        if plan_id == settings.whop_plan_ultra or product_id == settings.whop_plan_ultra:
                            highest_rank = max(highest_rank, 3)
                        elif plan_id == settings.whop_plan_pro or product_id == settings.whop_plan_pro:
                            highest_rank = max(highest_rank, 2)
                        elif plan_id == settings.whop_plan_starter or product_id == settings.whop_plan_starter:
                            highest_rank = max(highest_rank, 1)

                    if highest_rank == 3:
                        active_tier = "ultra"
                    elif highest_rank == 2:
                        active_tier = "pro"
                    elif highest_rank == 1:
                        active_tier = "starter"
                else:
                    logger.error(f"Whop memberships fetch failed with status {res.status_code}: {res.text}")
                    # Fallback to current event payload if request failed
                    active_tier = _fallback_tier_from_payload(event_name, data)
                    is_trialing = data.get("status") == "trialing"
        except Exception as e:
            logger.error(f"Error fetching memberships from Whop API: {e}")
            active_tier = _fallback_tier_from_payload(event_name, data)
            is_trialing = data.get("status") == "trialing"
    else:
        # If no whop_user_id, rely on the payload event type
        active_tier = _fallback_tier_from_payload(event_name, data)
        is_trialing = data.get("status") == "trialing"

    # Sync tier and limits with database presets
    try:
        presets_res = supabase.table("plan_presets").select("*").eq("tier", active_tier).execute()
        if presets_res.data:
            p = presets_res.data[0]
            supabase.table("accounts").update({
                "tier": active_tier,
                "monthly_limit": p["monthly_limit"],
                "rpm_limit": p["rpm_limit"],
                "tokens_5h_limit": p["tokens_5h_limit"],
                "tokens_7d_limit": p["tokens_7d_limit"],
                "openclaw_enabled": p["openclaw_enabled"],
                "max_agents": p["max_agents"],
                "agent_cpu": p["agent_cpu"],
                "agent_ram": p["agent_ram"],
                "is_trialing": is_trialing,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", account_id).execute()

            # Evict account caches immediately
            evict_account_caches(account_id)
            logger.info(f"Synced account {account_id} to tier {active_tier} (trialing: {is_trialing}) and updated limits")
            return {"status": "success", "tier": active_tier}
        else:
            logger.error(f"No plan preset found for tier: {active_tier}")
            raise HTTPException(status_code=500, detail="Configuration error: plan preset missing")
    except Exception as e:
        logger.error(f"Failed to sync account {account_id} with plan presets: {e}")
        raise HTTPException(status_code=500, detail="Database update failed")


def _fallback_tier_from_payload(event_name: str, data: dict) -> str:
    """Fallback logic to determine tier from the webhook payload directly."""
    is_activation = event_name in ("membership.activated", "membership_activated", "membership.went_valid")
    if not is_activation:
        return "free"

    plan_id = data.get("plan", {}).get("id") or data.get("plan_id")
    product_id = data.get("product", {}).get("id") or data.get("product_id")
    if plan_id == settings.whop_plan_ultra or product_id == settings.whop_plan_ultra:
        return "ultra"
    elif plan_id == settings.whop_plan_pro or product_id == settings.whop_plan_pro:
        return "pro"
    elif plan_id == settings.whop_plan_starter or product_id == settings.whop_plan_starter:
        return "starter"
    return "free"
