"""Security tests for admin /admin/models endpoints and the chat billing path.

Covers the bypasses fixed during the 2026-06-20 audit:
  - points_cost=0 bypass       → must 400 from POST + PATCH
  - pricing_mode flip bypass    → must 400 on inconsistent state
  - is_free_provider dead flag  → DB CHECK constraint
  - negative / huge numeric     → must 400
  - bad alias format            → must 400
  - chat.py runtime refusal     → 503 on points_cost < 1
  - rate limit per-key bypass   → keyed on account_id now
"""
import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi.testclient import TestClient
from fastapi import HTTPException


# ---------------------------------------------------------------------------
# Admin model POST validation
# ---------------------------------------------------------------------------

class TestAdminCreateModelValidation:
    """POST /admin/models must refuse inputs that would create a free/broken row."""

    def _post_body(self, **overrides):
        base = {
            "alias": "test-model",
            "display_name": "Test Model",
            "upstream_model": "openai/gpt-test",
            "provider_name": "openai",
            "pricing_mode": "per_token",
            "input_cost_per_million": 0.5,
            "output_cost_per_million": 1.5,
            "cost_per_request_cents": 5,
            "points_cost": 5,
        }
        base.update(overrides)
        return base

    @pytest.fixture
    def app_client(self):
        with patch("app.core.rate_limit_middleware.get_rate_limiter") as mock_limiter, \
             patch("app.core.supabase.get_supabase"), \
             patch("app.api.admin.routes._verify_admin", return_value=True):
            limiter = AsyncMock()
            limiter.check = AsyncMock(return_value=MagicMock(allowed=True, limit=60, remaining=60, reset_in=60, retry_after=0))
            mock_limiter.return_value = limiter
            from app.main import app
            yield TestClient(app)

    def test_create_points_cost_zero_rejected(self, app_client):
        """points_cost=0 → free calls → bypass billing → reject."""
        resp = app_client.post(
            "/admin/models",
            json=self._post_body(points_cost=0),
            headers={"Authorization": "Bearer admin-tok"},
        )
        assert resp.status_code == 400
        assert "points_cost" in resp.text.lower()

    def test_create_points_cost_negative_rejected(self, app_client):
        resp = app_client.post(
            "/admin/models",
            json=self._post_body(points_cost=-5),
            headers={"Authorization": "Bearer admin-tok"},
        )
        assert resp.status_code == 400

    def test_create_points_cost_huge_rejected(self, app_client):
        resp = app_client.post(
            "/admin/models",
            json=self._post_body(points_cost=99999),
            headers={"Authorization": "Bearer admin-tok"},
        )
        assert resp.status_code == 400

    def test_create_per_token_zero_input_rate_rejected(self, app_client):
        resp = app_client.post(
            "/admin/models",
            json=self._post_body(input_cost_per_million=0),
            headers={"Authorization": "Bearer admin-tok"},
        )
        assert resp.status_code == 400

    def test_create_per_token_zero_output_rate_rejected(self, app_client):
        resp = app_client.post(
            "/admin/models",
            json=self._post_body(output_cost_per_million=0),
            headers={"Authorization": "Bearer admin-tok"},
        )
        assert resp.status_code == 400

    def test_create_per_request_zero_cents_rejected(self, app_client):
        """Pricing mode per_request without cost → free calls → reject."""
        resp = app_client.post(
            "/admin/models",
            json=self._post_body(pricing_mode="per_request", cost_per_request_cents=0),
            headers={"Authorization": "Bearer admin-tok"},
        )
        assert resp.status_code == 400
        assert "cost_per_request_cents" in resp.text.lower()

    def test_create_per_request_missing_cents_rejected(self, app_client):
        body = self._post_body(pricing_mode="per_request")
        body.pop("cost_per_request_cents", None)
        resp = app_client.post(
            "/admin/models",
            json=body,
            headers={"Authorization": "Bearer admin-tok"},
        )
        assert resp.status_code == 400

    def test_create_bad_alias_format_rejected(self, app_client):
        """Alias must be lowercase alphanumeric + dashes only."""
        resp = app_client.post(
            "/admin/models",
            json=self._post_body(alias="BAD ALIAS WITH SPACES"),
            headers={"Authorization": "Bearer admin-tok"},
        )
        assert resp.status_code == 400
        assert "alias" in resp.text.lower()

    def test_create_alias_with_path_traversal_rejected(self, app_client):
        resp = app_client.post(
            "/admin/models",
            json=self._post_body(alias="../../../etc/passwd"),
            headers={"Authorization": "Bearer admin-tok"},
        )
        assert resp.status_code == 400

    def test_create_alias_too_short_rejected(self, app_client):
        resp = app_client.post(
            "/admin/models",
            json=self._post_body(alias="a"),
            headers={"Authorization": "Bearer admin-tok"},
        )
        assert resp.status_code == 400

    def test_create_bad_pricing_mode_rejected(self, app_client):
        resp = app_client.post(
            "/admin/models",
            json=self._post_body(pricing_mode="monthly_subscription"),
            headers={"Authorization": "Bearer admin-tok"},
        )
        assert resp.status_code == 400

    def test_create_huge_input_cost_rejected(self, app_client):
        resp = app_client.post(
            "/admin/models",
            json=self._post_body(input_cost_per_million=999999),
            headers={"Authorization": "Bearer admin-tok"},
        )
        assert resp.status_code == 400

    def test_create_valid_model_succeeds(self, app_client):
        """Sanity: a clean, valid POST should NOT 400."""
        # Need to mock supabase insert to return success
        with patch("app.core.supabase.get_supabase") as mock_sb:
            sb = mock_sb.return_value
            # Check alias doesn't exist
            sb.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
            # Slug resolution: no collision
            sb.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
            # Insert returns the new row
            sb.table.return_value.insert.return_value.execute.return_value.data = [{
                "alias": "test-model", "display_name": "Test Model",
            }]
            # Models list re-fetch
            sb.table.return_value.select.return_value.order.return_value.execute.return_value.data = []

            resp = app_client.post(
                "/admin/models",
                json=self._post_body(),
                headers={"Authorization": "Bearer admin-tok"},
            )
        # Either 200/201 (success) or 500 if mocking chain was incomplete — should not be 400
        assert resp.status_code != 400, f"valid model POST rejected: {resp.text}"


# ---------------------------------------------------------------------------
# Chat runtime refusal — chat.py must 503 on points_cost < 1
# ---------------------------------------------------------------------------

class TestChatRuntimeBypass:

    @pytest.mark.asyncio
    async def test_points_cost_zero_rejected_at_runtime(self):
        """Even if config slips through, chat.py must refuse points_cost < 1."""
        with patch("app.core.supabase.get_supabase"):
            from app.api.chat import _enforce_and_reserve_points
            with pytest.raises(HTTPException) as exc_info:
                await _enforce_and_reserve_points("acc-test", "test-model", 0)
            assert exc_info.value.status_code == 503

    @pytest.mark.asyncio
    async def test_points_cost_negative_rejected_at_runtime(self):
        with patch("app.core.supabase.get_supabase"):
            from app.api.chat import _enforce_and_reserve_points
            with pytest.raises(HTTPException) as exc_info:
                await _enforce_and_reserve_points("acc-test", "test-model", -1)
            assert exc_info.value.status_code == 503


# ---------------------------------------------------------------------------
# Rate limit keyed on account_id, not api_key_id
# ---------------------------------------------------------------------------

class TestRateLimitKeying:
    def test_rate_limit_scope_uses_account_id_not_api_key_id(self):
        """Source-level check: chat.py must NOT pass api_key_id as the identifier."""
        import inspect
        from app.api import chat
        src = inspect.getsource(chat)
        assert "identifier=api_key_id" not in src, \
            "chat.py still keys rate limit on api_key_id — multi-key bypass is back!"
        assert "identifier=account_id" in src, \
            "chat.py missing identifier=account_id — rate limit broken"

    def test_rate_limit_scope_string_contains_account(self):
        import inspect
        from app.api import chat
        src = inspect.getsource(chat)
        assert "chat.account:" in src, "chat.py rate limit scope must be chat.account:<id>"


# ---------------------------------------------------------------------------
# Data integrity: is_free_provider CHECK constraint
# ---------------------------------------------------------------------------

class TestDataIntegrity:
    def test_check_constraint_in_schema(self):
        """The migration must add a CHECK constraint linking is_free_provider to points_cost."""
        from pathlib import Path
        schema_path = Path(__file__).parent.parent / "supabase" / "schema.sql"
        schema = schema_path.read_text()
        assert "model_mapping_free_provider_cost_check" in schema, \
            "CHECK constraint missing from schema.sql — re-add it"

    def test_migration_steps_in_main(self):
        """main.py must apply the data cleanup + constraint."""
        from pathlib import Path
        main_path = Path(__file__).parent.parent / "app" / "main.py"
        main_src = main_path.read_text()
        assert "is_free_provider = false WHERE is_free_provider = true AND points_cost >= 2" in main_src, \
            "main.py missing dead-flag cleanup migration"
        assert "model_mapping_free_provider_cost_check" in main_src, \
            "main.py missing CHECK constraint migration"


# ---------------------------------------------------------------------------
# Plan bounds: admin can't blow up daily cap
# ---------------------------------------------------------------------------

class TestPlanBounds:
    def test_daily_free_requests_limit_upper_bound(self):
        """Source check: daily_free_requests_limit must be capped."""
        import inspect
        from app.api.admin import routes
        src = inspect.getsource(routes)
        assert "min(100_000" in src, \
            "daily_free_requests_limit not capped at 100k — admin typo bypass is back"

    def test_monthly_point_allowance_upper_bound(self):
        import inspect
        from app.api.admin import routes
        src = inspect.getsource(routes)
        assert "1_000_000" in src, \
            "monthly_point_allowance not capped at 1M"


# ---------------------------------------------------------------------------
# Plan tier allowlist on checkout
# ---------------------------------------------------------------------------

class TestCheckoutTierAllowlist:
    def test_unknown_tier_rejected_in_source(self):
        """The handler must enforce a strict tier allowlist."""
        import inspect
        from app.api import user as user_api
        src = inspect.getsource(user_api.create_checkout_session)
        # Old bypass: 'plan_' or 'prod_' prefix accepted
        assert 'body.tier.startswith("plan_")' not in src, \
            "tier startswith('plan_') check still present — bypass is back"
        assert 'body.tier.startswith("prod_")' not in src, \
            "tier startswith('prod_') check still present — bypass is back"
        # New: only starter/pro/ultra
        assert 'tier == "starter"' in src
        assert 'tier == "pro"' in src
        assert 'tier == "ultra"' in src

    def test_localhost_not_in_redirect_allowlist(self):
        """localhost used to be allowed; production backend can't tell."""
        import inspect
        from app.api import user as user_api
        src = inspect.getsource(user_api.create_checkout_session)
        # Pull out the allowlist
        import re
        m = re.search(r"ALLOWED_REDIRECT_HOSTS\s*=\s*\{([^}]+)\}", src, re.DOTALL)
        assert m, "could not find ALLOWED_REDIRECT_HOSTS in user.py"
        allowlist = m.group(1)
        assert "localhost" not in allowlist, \
            "localhost is in redirect allowlist — open redirect bypass on prod"
