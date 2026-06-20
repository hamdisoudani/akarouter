"""Tests for plan-tier points cost discount + promotional model discount.

Added 2026-06-20. Tests use mocked cache lookups so they don't need a live
Supabase connection.
"""

import pytest
from unittest.mock import patch

from app.core import chat_billing


# Mock data
META_MAP = {
    "akarouter-mini":  {"points_cost": 2, "is_promotional": True,  "promotional_discount_pct": 0.5, "display_name": "MiniMax M3"},
    "akarouter-haiku": {"points_cost": 1, "is_promotional": False, "promotional_discount_pct": 0.0, "display_name": "Claude Haiku 4.5"},
    "akarouter-gpt55": {"points_cost": 3, "is_promotional": False, "promotional_discount_pct": 0.0, "display_name": "GPT-5.5"},
    "akarouter-large": {"points_cost": 2, "is_promotional": False, "promotional_discount_pct": 0.0, "display_name": "Owl Alpha"},
    "akarouter-pro":   {"points_cost": 1, "is_promotional": False, "promotional_discount_pct": 0.0, "display_name": "DeepSeek V4 Flash"},
    "akarouter-flash": {"points_cost": 1, "is_promotional": False, "promotional_discount_pct": 0.0, "display_name": "GPT-OSS-120b"},
}

PLAN_MAP = {
    "free":       {"points_cost_multiplier": 1.0,  "monthly_point_allowance": 100,  "daily_free_requests_limit": 10},
    "starter":    {"points_cost_multiplier": 0.9,  "monthly_point_allowance": 500,  "daily_free_requests_limit": 0},
    "pro":        {"points_cost_multiplier": 0.75, "monthly_point_allowance": 2500, "daily_free_requests_limit": 0},
    "ultra":      {"points_cost_multiplier": 0.6,  "monthly_point_allowance": 7500, "daily_free_requests_limit": 0},
    "enterprise": {"points_cost_multiplier": 0.5,  "monthly_point_allowance": 25000, "daily_free_requests_limit": 0},
}


def _patch_caches(monkeypatch):
    """Patch get_model_metadata + get_plan_meta to use our mock maps."""
    monkeypatch.setattr(chat_billing, "get_model_metadata", lambda alias: META_MAP.get(alias, {}))
    monkeypatch.setattr(chat_billing, "get_plan_meta", lambda tier: PLAN_MAP.get(tier, {}))


class TestTierDiscount:
    """Higher plan tier → smaller multiplier → bigger discount on points cost."""

    def test_gpt55_drops_with_tier(self, monkeypatch):
        _patch_caches(monkeypatch)
        # Base 3pt
        free = chat_billing.get_effective_points_cost("akarouter-gpt55", "free")
        starter = chat_billing.get_effective_points_cost("akarouter-gpt55", "starter")
        pro = chat_billing.get_effective_points_cost("akarouter-gpt55", "pro")
        ultra = chat_billing.get_effective_points_cost("akarouter-gpt55", "ultra")
        enterprise = chat_billing.get_effective_points_cost("akarouter-gpt55", "enterprise")
        # free = round(3*1.0) = 3
        # starter = round(3*0.9) = 3 (rounded from 2.7)
        # pro = round(3*0.75) = 2 (rounded from 2.25)
        # ultra = round(3*0.6) = 2 (rounded from 1.8)
        # enterprise = round(3*0.5) = 2 (rounded from 1.5)
        assert free == 3
        assert pro == 2
        assert ultra == 2
        # Monotonic: cost never goes UP on higher tier
        assert starter <= free
        assert pro <= starter
        assert ultra <= pro
        assert enterprise <= ultra

    def test_large_drops_with_tier(self, monkeypatch):
        _patch_caches(monkeypatch)
        # Base 2pt
        free = chat_billing.get_effective_points_cost("akarouter-large", "free")
        pro = chat_billing.get_effective_points_cost("akarouter-large", "pro")
        ultra = chat_billing.get_effective_points_cost("akarouter-large", "ultra")
        # free = round(2*1.0) = 2
        # pro = round(2*0.75) = 2 (rounded from 1.5)
        # ultra = round(2*0.6) = 1 (rounded from 1.2)
        assert free == 2
        assert pro == 2
        assert ultra == 1

    def test_minimum_cost_is_one_point(self, monkeypatch):
        """Even with deep discounts, never charge 0 points."""
        _patch_caches(monkeypatch)
        # MiniMax with 50% promo on enterprise tier: 2*0.5*0.5 = 0.5 → round to 0 → floor to 1
        cost = chat_billing.get_effective_points_cost("akarouter-mini", "enterprise")
        assert cost >= 1
        # Also for flash (base 1) on enterprise: 1*0.5 = 0.5 → floor to 1
        cost2 = chat_billing.get_effective_points_cost("akarouter-flash", "enterprise")
        assert cost2 >= 1

    def test_unknown_tier_uses_free_defaults(self, monkeypatch):
        _patch_caches(monkeypatch)
        # Unknown tier → fallback to free (1.0 multiplier)
        cost = chat_billing.get_effective_points_cost("akarouter-gpt55", "nonexistent")
        assert cost == 3

    def test_unknown_alias_returns_base(self, monkeypatch):
        _patch_caches(monkeypatch)
        # Unknown alias → empty meta dict → defaults to points_cost=1
        cost = chat_billing.get_effective_points_cost("akarouter-doesnotexist", "pro")
        # points_cost=None → fallback to 1
        assert cost == 1


class TestPromotionalDiscount:
    """is_promotional models get extra % off on top of tier discount."""

    def test_minimax_is_cheaper_than_non_promotional(self, monkeypatch):
        _patch_caches(monkeypatch)
        # MiniMax is promotional with 50% off, base 2pt
        # GPT-5.5 is NOT promotional, base 3pt
        # On free tier, MiniMax should be cheaper: 2*0.5 = 1pt vs 3pt
        minimax = chat_billing.get_effective_points_cost("akarouter-mini", "free")
        gpt55 = chat_billing.get_effective_points_cost("akarouter-gpt55", "free")
        assert minimax < gpt55

    def test_promotional_discount_stacks_with_tier(self, monkeypatch):
        _patch_caches(monkeypatch)
        # MiniMax with 50% promo on ultra: 2 * 0.5 * 0.6 = 0.6 → round to 1 → floor 1
        cost = chat_billing.get_effective_points_cost("akarouter-mini", "ultra")
        # 1 pt (the minimum) — this is a "loss leader"
        assert cost == 1


class TestBillingBreakdown:
    """get_billing_breakdown() returns the full cost waterfall for the UI."""

    def test_breakdown_includes_all_factors(self, monkeypatch):
        _patch_caches(monkeypatch)
        bd = chat_billing.get_billing_breakdown("akarouter-gpt55", "pro")
        assert bd["model_alias"] == "akarouter-gpt55"
        assert bd["account_tier"] == "pro"
        assert bd["base_points_cost"] == 3
        assert bd["plan_multiplier"] == 0.75
        assert bd["is_promotional"] is False
        assert bd["promotional_discount_pct"] == 0.0
        assert bd["after_tier_discount"] == 2
        assert bd["effective_points_cost"] == 2
        assert bd["monthly_point_allowance"] == 2500

    def test_breakdown_for_promotional_model(self, monkeypatch):
        _patch_caches(monkeypatch)
        bd = chat_billing.get_billing_breakdown("akarouter-mini", "free")
        assert bd["is_promotional"] is True
        assert bd["promotional_discount_pct"] == 0.5
        assert bd["after_tier_discount"] == 2  # 2 * 1.0
        assert bd["effective_points_cost"] == 1  # 2 * 0.5 rounded, then floored to 1
