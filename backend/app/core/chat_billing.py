"""Chat billing helpers (added 2026-06-20).

Computes the effective points cost for a chat request, factoring in:
  - plan tier multiplier (higher tier = lower multiplier = bigger discount)
  - promotional discount on the model (e.g. MiniMax-M3 launch promo)

Formula:
  effective_points = max(1, round(base_points * plan_multiplier * (1 - promotional_discount_pct)))

The final floor of 1 ensures we never charge 0 points (free tier still needs
the request log + daily cap tracking, and we don't want division by zero
in downstream accounting).
"""

from __future__ import annotations

import logging
from typing import Any

from app.core.cache import get_model_metadata, get_plan_meta

logger = logging.getLogger(__name__)


def get_effective_points_cost(model_alias: str, account_tier: str = "free") -> int:
    """Compute the effective points cost for a model given the user's plan tier.

    Args:
        model_alias: e.g. "akarouter-mini"
        account_tier: e.g. "free" | "starter" | "pro" | "ultra" | "enterprise"

    Returns:
        Effective points to charge. Always >= 1.
    """
    meta = get_model_metadata(model_alias)
    base_points = int(meta.get("points_cost") or 1)
    if base_points < 1:
        base_points = 1

    plan = get_plan_meta(account_tier or "free")
    multiplier = float(plan.get("points_cost_multiplier") or 1.0)
    # Clamp to (0, 1.0]
    if multiplier <= 0:
        multiplier = 1.0
    elif multiplier > 1.0:
        multiplier = 1.0

    promo_pct = float(meta.get("promotional_discount_pct") or 0.0)
    # Clamp to [0, 1]
    promo_pct = max(0.0, min(1.0, promo_pct))

    # Apply multiplier first (higher plan = lower cost), then promotional discount.
    effective = base_points * multiplier * (1.0 - promo_pct)
    result = max(1, round(effective))

    if result != base_points:
        logger.debug(
            f"effective points cost for {model_alias} on tier={account_tier}: "
            f"base={base_points} multiplier={multiplier} promo={promo_pct} -> {result}"
        )
    return result


def get_billing_breakdown(model_alias: str, account_tier: str = "free") -> dict[str, Any]:
    """Return a breakdown of all factors that go into the effective cost.

    Useful for the frontend /upgrade page ("this model costs X pts on your tier").
    """
    meta = get_model_metadata(model_alias)
    base_points = int(meta.get("points_cost") or 1)
    if base_points < 1:
        base_points = 1

    plan = get_plan_meta(account_tier or "free")
    multiplier = float(plan.get("points_cost_multiplier") or 1.0)
    if multiplier <= 0:
        multiplier = 1.0
    elif multiplier > 1.0:
        multiplier = 1.0

    promo_pct = float(meta.get("promotional_discount_pct") or 0.0)
    promo_pct = max(0.0, min(1.0, promo_pct))

    after_tier = round(base_points * multiplier)
    after_promo = round(after_tier * (1.0 - promo_pct))
    effective = max(1, after_promo)

    return {
        "model_alias": model_alias,
        "account_tier": account_tier,
        "base_points_cost": base_points,
        "plan_multiplier": multiplier,
        "after_tier_discount": max(1, after_tier),
        "is_promotional": bool(meta.get("is_promotional")),
        "promotional_discount_pct": promo_pct,
        "after_promotional_discount": effective,
        "effective_points_cost": effective,
        "monthly_point_allowance": int(plan.get("monthly_point_allowance") or 0),
    }
