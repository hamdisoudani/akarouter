"""AKAROUTER Whop webhooks router."""
import json
import hmac
import hashlib
import logging
import time
import base64
import uuid
import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Request, HTTPException

from app.core.config import settings
from app.core.supabase import get_supabase
from app.core.cache import evict_account_caches
from app.core.http_client import get_http_client

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/v1/webhooks/whop")
async def whop_webhook_handler(
    request: Request
):
    """
    Handle incoming Whop webhooks to sync subscriptions using Standard Webhooks verification.
    """
    webhook_id = request.headers.get("webhook-id") or request.headers.get("svix-id")
    webhook_timestamp = request.headers.get("webhook-timestamp") or request.headers.get("svix-timestamp")
    webhook_signature = request.headers.get("webhook-signature") or request.headers.get("svix-signature") or request.headers.get("x-whop-signature")

    if not webhook_id or not webhook_timestamp or not webhook_signature:
        logger.warning("Whop webhook rejected: Missing standard signature/timestamp headers")
        raise HTTPException(status_code=401, detail="Missing signature headers")

    # Verify timestamp freshness to prevent replay attacks
    try:
        ts = int(webhook_timestamp)
        if abs(time.time() - ts) > 300:
            logger.warning(f"Whop webhook rejected: Timestamp is stale (delta: {abs(time.time() - ts)}s)")
            raise HTTPException(status_code=401, detail="Webhook timestamp too old (replay rejected)")
    except (ValueError, TypeError):
        logger.warning("Whop webhook rejected: Invalid timestamp format")
        raise HTTPException(status_code=401, detail="Invalid webhook timestamp")

    payload_bytes = await request.body()

    # Verify Whop Webhook Signature
    if not settings.whop_webhook_secret:
        logger.error("Whop webhook secret is not configured in settings")
        raise HTTPException(status_code=500, detail="Webhook configuration error")

    try:
        # SECURITY: decode the webhook secret EXACTLY ONCE using the documented Standard
        # Webhooks encoding (URL-safe base64). The previous code tried 4 different encodings
        # (hex, raw utf-8 stripped, raw utf-8 full, base64) and accepted the request if ANY
        # encoding produced a matching HMAC. This is "accept the weakest valid interpretation"
        # — if the secret is ever leaked in any of those encodings, the request can be forged.
        # Standard Webhooks / Whop uses base64 (the "whsec_" prefix is just a label).
        secret_str = settings.whop_webhook_secret
        if secret_str.startswith("whsec_"):
            secret_str = secret_str[len("whsec_"):]

        try:
            # Try URL-safe base64 first (Standard Webhooks / Whop default)
            secret_bytes = base64.urlsafe_b64decode(secret_str + "=" * (-len(secret_str) % 4))
        except Exception:
            # Fall back to standard base64 for backwards compat with Svix-style secrets
            try:
                secret_bytes = base64.b64decode(secret_str + "=" * (-len(secret_str) % 4))
            except Exception as e:
                logger.error(f"Whop webhook secret is not valid base64: {e}")
                raise HTTPException(status_code=500, detail="Webhook configuration error")

        # Parse signatures from header (could be space-separated list)
        signatures = webhook_signature.split(" ")
        v1_signatures = []
        for sig in signatures:
            if sig.startswith("v1,"):
                v1_signatures.append(sig.split(",", 1)[1])

        if not v1_signatures:
            logger.warning("Whop webhook rejected: No v1 signature found in header")
            raise HTTPException(status_code=401, detail="Invalid signature format")

        # Construct signed payload according to Standard Webhooks spec:
        # `<webhook_id>.<webhook_timestamp>.<body>`
        signed_content = f"{webhook_id}.{webhook_timestamp}.".encode("utf-8") + payload_bytes

        # Compute HMAC-SHA256 with the (single, validated) secret
        computed_sig_bytes = hmac.new(
            key=secret_bytes,
            msg=signed_content,
            digestmod=hashlib.sha256
        ).digest()

        # Standard Webhooks encodes the signature as base64. Compute both forms in case
        # Whop sends a hex variant, but only accept ONE match — not "any of 4 encodings".
        computed_sig_b64 = base64.b64encode(computed_sig_bytes).decode("utf-8")

        verified = any(
            hmac.compare_digest(computed_sig_b64, v1_sig) for v1_sig in v1_signatures
        )

        if not verified:
            logger.warning("Whop webhook rejected: Invalid signature")
            raise HTTPException(status_code=401, detail="Invalid signature")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during Whop signature verification: {e}", exc_info=True)
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

    try:
        uuid.UUID(str(account_id))
    except ValueError:
        logger.warning(f"Whop webhook resolved account_id is not a valid UUID: {account_id}")
        return {"status": "ignored", "reason": "invalid_account_id_format"}

    # SECURITY: webhook idempotency via `processed_webhooks` table. Insert the
    # webhook_id before any side effects. If the insert violates the unique
    # constraint, this is a duplicate delivery (Whop retries on transient errors)
    # and we return 200 to acknowledge it without re-applying state changes.
    try:
        insert_res = supabase.table("processed_webhooks").insert({
            "webhook_id": webhook_id,
            "source": "whop",
            "account_id": account_id,
            "event_type": event_name,
            "status": "received",
        }).execute()
        if not insert_res.data:
            logger.warning("processed_webhooks insert returned no data; proceeding anyway")
    except Exception as e:
        # Detect unique-constraint violation (PostgREST returns 409 with code 23505).
        is_duplicate = False
        err_str = str(e)
        if "duplicate key" in err_str.lower() or "23505" in err_str or "already exists" in err_str.lower():
            is_duplicate = True
        if is_duplicate:
            logger.info(f"Duplicate Whop webhook ignored: {webhook_id} (event: {event_name})")
            # Mark as processed in the dedup log so we can audit later
            try:
                supabase.table("processed_webhooks").update({
                    "status": "duplicate_skipped",
                    "processed_at": datetime.now(timezone.utc).isoformat()
                }).eq("webhook_id", webhook_id).execute()
            except Exception:
                pass
            return {"status": "success", "reason": "duplicate_webhook_skipped"}
        # Any other DB error: log but continue (we don't want to block legitimate webhooks
        # if the dedup table is briefly unavailable). Operators should monitor the logs.
        logger.error(f"processed_webhooks insert failed (continuing): {e}")

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
            client = get_http_client()
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

    # Idempotency check: fetch current account limits and tier
    current_acc_res = None
    try:
        current_acc_res = supabase.table("accounts").select("tier, monthly_limit, rpm_limit, tokens_5h_limit, tokens_7d_limit, openclaw_enabled, max_agents, agent_cpu, agent_ram, is_trialing").eq("id", account_id).execute()
    except Exception as e:
        logger.error(f"Failed to query current account state for idempotency check: {e}")

    # Sync tier and limits with database presets
    try:
        presets_res = supabase.table("plan_presets").select("*").eq("tier", active_tier).execute()
        if presets_res.data:
            p = presets_res.data[0]
            
            # Compare current state to avoid redundant updates
            is_already_synced = False
            if current_acc_res and current_acc_res.data:
                curr = current_acc_res.data[0]
                if (
                    curr.get("tier") == active_tier and
                    curr.get("is_trialing") == is_trialing and
                    float(curr.get("monthly_limit") or 0.0) == float(p["monthly_limit"] or 0.0) and
                    int(curr.get("rpm_limit") or 0) == int(p["rpm_limit"] or 0) and
                    float(curr.get("tokens_5h_limit") or 0.0) == float(p["tokens_5h_limit"] or 0.0) and
                    float(curr.get("tokens_7d_limit") or 0.0) == float(p["tokens_7d_limit"] or 0.0) and
                    curr.get("openclaw_enabled") == p["openclaw_enabled"] and
                    int(curr.get("max_agents") or 0) == int(p["max_agents"] or 0) and
                    int(curr.get("agent_cpu") or 0) == int(p["agent_cpu"] or 0) and
                    int(curr.get("agent_ram") or 0) == int(p["agent_ram"] or 0)
                ):
                    is_already_synced = True

            if is_already_synced:
                logger.info(f"Account {account_id} is already in sync with tier {active_tier}. Skipping DB write.")
                # Mark webhook as processed (idempotent skip path)
                try:
                    supabase.table("processed_webhooks").update({
                        "status": "idempotent_skip",
                        "processed_at": datetime.now(timezone.utc).isoformat()
                    }).eq("webhook_id", webhook_id).execute()
                except Exception:
                    pass
                return {"status": "success", "tier": active_tier, "reason": "idempotent_skip"}

            # SECURITY: serialize tier-upgrade writes for this account.
            # A Whop webhook and a user-initiated checkout flow can both
            # try to update `accounts.tier` for the same account within
            # milliseconds of each other. Without this lock, last-writer-wins
            # loses one of the two updates.
            #
            # Blocking acquire: this is a webhook handler — by the time
            # we've verified the HMAC signature, we want this write to
            # succeed deterministically. Worst case is a 50-100ms wait.
            from app.core.locks import get_lock_backend
            locks = get_lock_backend()
            tier_lock = await locks.tier_upgrade(account_id)
            async with tier_lock:
                # Wrap the database sync in a retry loop
                max_retries = 3
                for attempt in range(max_retries):
                    try:
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
                        break
                    except Exception as db_err:
                        if attempt == max_retries - 1:
                            raise db_err
                        await asyncio.sleep(2 ** attempt)

            # Evict account caches immediately
            evict_account_caches(account_id)
            # Mark webhook as processed
            try:
                supabase.table("processed_webhooks").update({
                    "status": "applied",
                    "processed_at": datetime.now(timezone.utc).isoformat()
                }).eq("webhook_id", webhook_id).execute()
            except Exception as mark_err:
                logger.warning(f"Failed to mark webhook {webhook_id} as processed: {mark_err}")
            logger.info(f"Synced account {account_id} to tier {active_tier} (trialing: {is_trialing}) and updated limits")
            return {"status": "success", "tier": active_tier}
        else:
            logger.error(f"No plan preset found for tier: {active_tier}")
            # Mark webhook as failed
            try:
                supabase.table("processed_webhooks").update({
                    "status": "failed_no_preset",
                    "processed_at": datetime.now(timezone.utc).isoformat()
                }).eq("webhook_id", webhook_id).execute()
            except Exception:
                pass
            raise HTTPException(status_code=500, detail="Configuration error: plan preset missing")
    except Exception as e:
        logger.error(f"Failed to sync account {account_id} with plan presets: {e}")
        # Mark webhook as failed
        try:
            supabase.table("processed_webhooks").update({
                "status": "failed_sync",
                "processed_at": datetime.now(timezone.utc).isoformat()
            }).eq("webhook_id", webhook_id).execute()
        except Exception:
            pass
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
