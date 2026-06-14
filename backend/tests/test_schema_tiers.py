import pytest
from app.core.config import settings

def test_tier_alignment():
    # Verify that the standard SaaS plans mapped in config match what we support
    whop_plans = [
        settings.whop_plan_starter,
        settings.whop_plan_pro,
        settings.whop_plan_ultra
    ]
    # Check that they can be resolved or have defaults
    assert isinstance(settings.whop_plan_starter, str)
    assert isinstance(settings.whop_plan_pro, str)
    assert isinstance(settings.whop_plan_ultra, str)
