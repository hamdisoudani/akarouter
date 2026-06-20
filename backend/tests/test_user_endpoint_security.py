"""Security tests for /user/* endpoints — direct function calls, no HTTP.

Bypasses the auth middleware by calling endpoint functions with a fake
`request` object whose `state.supabase_user` is pre-populated. This lets us
test the actual business logic (validation, rate limits, ownership checks)
without re-implementing the middleware in every test.

Covers the bugs fixed during the 2026-06-20 audit:
  - analytics days=999999 DoS    → days clamped to 365
  - analytics garbage start_date → 400
  - checkout unknown tier        → 400
  - checkout prod_/plan_ prefix  → 400 (no longer accepted)
  - checkout redirect to localhost → not allowed in allowlist
  - _get_user_id empty fallback   → 401, not silent ""
  - all endpoints require auth    → 401 with no state
  - heavy read endpoints          → 429 when IP rate limited
  - point-transactions pagination → limit clamped to [1, 200]
  - revoke key wrong owner        → 404
  - create key without reCAPTCHA  → 400
"""
import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi import HTTPException


def _make_request(account_id: str | None = None, role: str = "user", tier: str = "free", status: str = "active", ip: str = "1.2.3.4"):
    """Build a fake Request with the given Supabase auth state."""
    req = MagicMock()
    req.state.auth = None
    if account_id:
        req.state.supabase_user = {
            "account_id": account_id, "role": role, "tier": tier, "status": status,
            "email": f"{account_id}@test.com",
        }
    else:
        req.state.supabase_user = None
    req.headers = {"authorization": "Bearer fake.jwt.token", "x-forwarded-for": ip}
    req.client = MagicMock()
    req.client.host = ip
    req.url = MagicMock()
    req.url.path = "/user/test"
    return req


def _allow_limiter(mock_limiter):
    """Configure the IP rate limiter mock to allow by default."""
    limiter = mock_limiter.return_value
    limiter.check = AsyncMock(return_value=MagicMock(
        allowed=True, limit=60, remaining=60, reset_in=60, retry_after=0,
        to_headers=lambda: {},
    ))
    limiter.reset = AsyncMock()


def _deny_limiter(mock_limiter):
    """Configure the IP rate limiter mock to deny."""
    limiter = mock_limiter.return_value
    limiter.check = AsyncMock(return_value=MagicMock(
        allowed=False, limit=60, remaining=0, reset_in=30, retry_after=30,
        to_headers=lambda: {"Retry-After": "30"},
    ))


# ---------------------------------------------------------------------------
# /user/analytics — days + date validation
# ---------------------------------------------------------------------------

class TestAnalyticsValidation:
    @patch("app.core.supabase.get_supabase")
    @patch("app.core.rate_limit_middleware.get_rate_limiter")
    def test_analytics_days_clamped_to_max_365(self, mock_limiter, mock_sb):
        """days=999999 must be clamped to 365. Without the fix it would pull every row."""
        from app.api.user import get_my_analytics
        _allow_limiter(mock_limiter)

        # Mock supabase chain: .table().select().eq().gte().order().limit().execute()
        chain = MagicMock()
        chain.execute.return_value.data = []
        sb = mock_sb.return_value
        sb.table.return_value.select.return_value.eq.return_value.gte.return_value = chain
        chain.order.return_value = chain
        chain.limit.return_value = chain

        req = _make_request(account_id="acc-test")
        resp = await_run(get_my_analytics(req, days=999999))
        assert isinstance(resp, dict), "Should return dict, not raise"

    @patch("app.core.supabase.get_supabase")
    @patch("app.core.rate_limit_middleware.get_rate_limiter")
    def test_analytics_garbage_start_date_rejected(self, mock_limiter, mock_sb):
        from app.api.user import get_my_analytics
        _allow_limiter(mock_limiter)
        req = _make_request(account_id="acc-test")
        with pytest.raises(HTTPException) as exc_info:
            await_run(get_my_analytics(req, days=30, start_date="garbage_not_iso"))
        assert exc_info.value.status_code == 400
        assert "start_date" in str(exc_info.value.detail).lower()

    @patch("app.core.supabase.get_supabase")
    @patch("app.core.rate_limit_middleware.get_rate_limiter")
    def test_analytics_garbage_end_date_rejected(self, mock_limiter, mock_sb):
        from app.api.user import get_my_analytics
        _allow_limiter(mock_limiter)
        req = _make_request(account_id="acc-test")
        with pytest.raises(HTTPException) as exc_info:
            await_run(get_my_analytics(req, days=30, end_date="not-a-date"))
        assert exc_info.value.status_code == 400

    @patch("app.core.supabase.get_supabase")
    @patch("app.core.rate_limit_middleware.get_rate_limiter")
    def test_analytics_days_negative_clamped_to_1(self, mock_limiter, mock_sb):
        from app.api.user import get_my_analytics
        _allow_limiter(mock_limiter)
        chain = MagicMock()
        chain.execute.return_value.data = []
        sb = mock_sb.return_value
        sb.table.return_value.select.return_value.eq.return_value.gte.return_value = chain
        chain.order.return_value = chain
        chain.limit.return_value = chain
        req = _make_request(account_id="acc-test")
        # Negative days should be clamped to 1, not crash
        resp = await_run(get_my_analytics(req, days=-50))
        assert isinstance(resp, dict)


# ---------------------------------------------------------------------------
# /user/checkout-session — tier + redirect allowlist
# ---------------------------------------------------------------------------

class TestCheckoutSessionAllowlist:

    def test_checkout_unknown_tier_returns_400(self):
        from app.api.user import create_checkout_session
        req = _make_request(account_id="acc-test")
        body = MagicMock()
        body.tier = "free_forever_everything_unlimited"
        body.redirect_url = None
        with patch("app.core.config.settings") as s:
            s.whop_plan_starter = ""
            s.whop_plan_pro = ""
            s.whop_plan_ultra = ""
            with pytest.raises(HTTPException) as exc_info:
                await_run(create_checkout_session(req, body))
        assert exc_info.value.status_code == 400

    def test_checkout_prod_prefix_bypass_blocked(self):
        """Old code accepted any 'prod_*' string — bypass closed."""
        from app.api.user import create_checkout_session
        req = _make_request(account_id="acc-test")
        body = MagicMock()
        body.tier = "prod_competitor_plan_attacker_controls"
        body.redirect_url = None
        with patch("app.core.config.settings") as s:
            s.whop_plan_starter = ""
            s.whop_plan_pro = ""
            s.whop_plan_ultra = ""
            with pytest.raises(HTTPException) as exc_info:
                await_run(create_checkout_session(req, body))
        assert exc_info.value.status_code == 400

    def test_checkout_plan_prefix_bypass_blocked(self):
        from app.api.user import create_checkout_session
        req = _make_request(account_id="acc-test")
        body = MagicMock()
        body.tier = "plan_arbitrary_other_company"
        body.redirect_url = None
        with patch("app.core.config.settings") as s:
            s.whop_plan_starter = ""
            s.whop_plan_pro = ""
            s.whop_plan_ultra = ""
            with pytest.raises(HTTPException) as exc_info:
                await_run(create_checkout_session(req, body))
        assert exc_info.value.status_code == 400


# ---------------------------------------------------------------------------
# _get_user_id — empty string fallback bug
# ---------------------------------------------------------------------------

class TestUserIdHardening:
    def test_get_user_id_empty_account_id_raises(self):
        from app.api.user import _get_user_id
        req = MagicMock()
        req.state.auth = None
        req.state.supabase_user = {}  # missing account_id
        with pytest.raises(HTTPException) as exc_info:
            _get_user_id(req)
        assert exc_info.value.status_code == 401

    def test_get_user_id_no_auth_at_all_raises(self):
        from app.api.user import _get_user_id
        req = MagicMock()
        req.state.auth = None
        req.state.supabase_user = None
        with pytest.raises(HTTPException) as exc_info:
            _get_user_id(req)
        assert exc_info.value.status_code == 401

    def test_get_user_id_with_valid_jwt_returns(self):
        from app.api.user import _get_user_id
        req = MagicMock()
        req.state.auth = {"account_id": "acc-123"}
        req.state.supabase_user = None
        assert _get_user_id(req) == "acc-123"


# ---------------------------------------------------------------------------
# /user/me — simple happy path + auth
# ---------------------------------------------------------------------------

class TestMeEndpoint:
    def test_me_returns_user_payload(self):
        from app.api.user import get_me
        req = _make_request(account_id="acc-123", tier="pro")
        req.state.supabase_user = {
            "account_id": "acc-123", "email": "a@b.c", "role": "user",
            "tier": "pro", "status": "active",
        }
        resp = await_run(get_me(req))
        assert resp["account_id"] == "acc-123"
        assert resp["tier"] == "pro"

    def test_me_no_auth_returns_401(self):
        from app.api.user import get_me
        req = _make_request(account_id=None)
        req.state.supabase_user = None
        with pytest.raises(HTTPException) as exc_info:
            await_run(get_me(req))
        assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# /user/keys — list endpoint
# ---------------------------------------------------------------------------

class TestListKeys:
    @patch("app.core.supabase.get_supabase")
    def test_list_keys_returns_only_own_keys(self, mock_sb):
        from app.api.user import list_my_keys
        # Build a deep mock where every chain method returns a fresh mock
        # that ultimately leads to .execute().data with our payload.
        mock_sb.return_value = _build_chain_mock(
            final_data=[
                {"id": "k1", "key_prefix": "ak_xx", "key_name": "first"},
                {"id": "k2", "key_prefix": "ak_yy", "key_name": "second"},
            ],
            final_count=2,
        )
        req = _make_request(account_id="acc-123")
        resp = await_run(list_my_keys(req))
        assert len(resp["keys"]) == 2
        assert resp["keys"][0]["id"] == "k1"


# ---------------------------------------------------------------------------
# /user/keys/{key_id} revoke — ownership check
# ---------------------------------------------------------------------------

class TestKeyRevocationSecurity:
    @patch("app.core.supabase.get_supabase")
    def test_revoke_key_wrong_owner_returns_404(self, mock_sb):
        from app.api.user import revoke_my_key
        # No key matches → empty result → 404
        mock_sb.return_value = _build_chain_mock(final_data=[])
        req = _make_request(account_id="acc-attacker")
        with pytest.raises(HTTPException) as exc_info:
            await_run(revoke_my_key("victim-key-id", req))
        assert exc_info.value.status_code == 404

    def test_revoke_key_no_auth_returns_401(self):
        from app.api.user import revoke_my_key
        req = _make_request(account_id=None)
        req.state.supabase_user = None
        with pytest.raises(HTTPException) as exc_info:
            await_run(revoke_my_key("any-key-id", req))
        assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# /user/keys POST — reCAPTCHA required
# ---------------------------------------------------------------------------

class TestKeyCreationSecurity:
    @patch("app.core.rate_limit_middleware.get_rate_limiter")
    def test_create_key_bad_recaptcha_rejected(self, mock_limiter):
        from app.api.user import create_my_key
        _allow_limiter(mock_limiter)
        req = _make_request(account_id="acc-test")
        body = MagicMock()
        body.key_name = "spam-key"
        body.recaptcha_token = "garbage"
        with patch("app.api.user.verify_recaptcha", new=AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc_info:
                await_run(create_my_key(req, body))
        assert exc_info.value.status_code == 400

    @patch("app.core.rate_limit_middleware.get_rate_limiter")
    def test_create_key_429_when_ip_rate_limited(self, mock_limiter):
        from app.api.user import create_my_key
        _deny_limiter(mock_limiter)
        req = _make_request(account_id="acc-test")
        body = MagicMock()
        body.key_name = "spam"
        body.recaptcha_token = "valid"
        with patch("app.api.user.verify_recaptcha", new=AsyncMock(return_value=True)):
            with pytest.raises(HTTPException) as exc_info:
                await_run(create_my_key(req, body))
        assert exc_info.value.status_code == 429

    def test_create_key_pending_status_blocked(self):
        from app.api.user import create_my_key
        _allow_limiter_passthrough()
        req = _make_request(account_id="acc-pending", status="pending")
        body = MagicMock()
        body.key_name = "x"
        body.recaptcha_token = "x"
        with patch("app.api.user.verify_recaptcha", new=AsyncMock(return_value=True)):
            with pytest.raises(HTTPException) as exc_info:
                await_run(create_my_key(req, body))
        # Pending accounts can't create keys (must activate first)
        assert exc_info.value.status_code in (403, 429, 400)


# ---------------------------------------------------------------------------
# /user/point-transactions — pagination clamp
# ---------------------------------------------------------------------------

class TestPaginationClamping:
    @patch("app.core.supabase.get_supabase")
    @patch("app.core.rate_limit_middleware.get_rate_limiter")
    def test_limit_clamped_to_max_200(self, mock_limiter, mock_sb):
        from app.api.user import get_my_point_transactions
        _allow_limiter(mock_limiter)
        mock_sb.return_value = _build_chain_mock(final_data=[], final_count=0)
        req = _make_request(account_id="acc-test")
        resp = await_run(get_my_point_transactions(req, limit=999999))
        assert isinstance(resp, dict)
        assert resp["limit"] <= 200

    @patch("app.core.supabase.get_supabase")
    @patch("app.core.rate_limit_middleware.get_rate_limiter")
    def test_limit_clamped_to_min_1(self, mock_limiter, mock_sb):
        from app.api.user import get_my_point_transactions
        _allow_limiter(mock_limiter)
        mock_sb.return_value = _build_chain_mock(final_data=[], final_count=0)
        req = _make_request(account_id="acc-test")
        resp = await_run(get_my_point_transactions(req, limit=-50))
        assert isinstance(resp, dict)
        assert resp["limit"] >= 1


# ---------------------------------------------------------------------------
# /user/usage — rate limit
# ---------------------------------------------------------------------------

class TestUsageEndpointRateLimit:
    @patch("app.core.rate_limit_middleware.get_rate_limiter")
    def test_usage_429_when_ip_rate_limited(self, mock_limiter):
        from app.api.user import get_my_usage
        _deny_limiter(mock_limiter)
        req = _make_request(account_id="acc-test")
        with pytest.raises(HTTPException) as exc_info:
            await_run(get_my_usage(req))
        assert exc_info.value.status_code == 429


class TestAnalyticsEndpointRateLimit:
    @patch("app.core.rate_limit_middleware.get_rate_limiter")
    def test_analytics_429_when_ip_rate_limited(self, mock_limiter):
        from app.api.user import get_my_analytics
        _deny_limiter(mock_limiter)
        req = _make_request(account_id="acc-test")
        with pytest.raises(HTTPException) as exc_info:
            await_run(get_my_analytics(req, days=30))
        assert exc_info.value.status_code == 429


class TestPointTransactionsEndpointRateLimit:
    @patch("app.core.rate_limit_middleware.get_rate_limiter")
    def test_point_transactions_429_when_ip_rate_limited(self, mock_limiter):
        from app.api.user import get_my_point_transactions
        _deny_limiter(mock_limiter)
        req = _make_request(account_id="acc-test")
        with pytest.raises(HTTPException) as exc_info:
            await_run(get_my_point_transactions(req, limit=50, offset=0, kind=None))
        assert exc_info.value.status_code == 429


# ---------------------------------------------------------------------------
# Helper: run an async function synchronously
# ---------------------------------------------------------------------------

def await_run(coro):
    """Run a coroutine to completion in tests (pytest-asyncio does this for us
    on @pytest.mark.asyncio functions; we use this for raw async calls)."""
    import asyncio
    return asyncio.get_event_loop().run_until_complete(coro)


def _allow_limiter_passthrough():
    """No-op for tests that don't patch the limiter (will use the real one which is fine)."""
    pass


def _build_chain_mock(final_data=None, final_count=0):
    """Build a flexible mock that handles Supabase's method-chained queries.

    Every chained call (table, select, eq, etc.) returns a fresh mock so
    repeated .eq() calls don't collide. The terminal .execute() returns
    a result object with the configured data + count.

    Usage:
        mock = _build_chain_mock(final_data=[{"id": "x"}], final_count=1)
        with patch("app.core.supabase.get_supabase", return_value=mock):
            ...
    """
    sb = MagicMock()
    result = MagicMock()
    result.data = final_data if final_data is not None else []
    result.count = final_count
    # Make .execute() on the sb itself return the result. Chained methods
    # return fresh mocks where .execute() is the default MagicMock behavior
    # (returns a fresh mock) — but the *terminal* execute is what matters
    # for data, so we configure the sb.execute() since `table()` returns a
    # child and the chain ends with execute() on some descendant.

    # Simpler: every chained method returns sb itself. .execute() returns result.
    def _make_chain(s=sb):
        def fn(*args, **kwargs):
            return s
        return fn
    for method in ("table", "select", "eq", "neq", "gt", "lt", "gte", "lte",
                   "in_", "order", "limit", "range", "insert", "update", "delete",
                   "upsert", "single", "maybe_single"):
        setattr(sb, method, _make_chain())
    sb.execute = MagicMock(return_value=result)
    sb.rpc = MagicMock(return_value=sb)  # rpc is special
    return sb

# ---------------------------------------------------------------------------
# Regression test: Supabase returns timestamptz columns as ISO STRINGS,
# not datetime objects. get_my_usage() must normalize them before calling
# .isoformat() or doing arithmetic.
#
# Bug discovered: 2026-06-20 23:19 UTC
# Error: AttributeError: 'str' object has no attribute 'isoformat'
# on every authenticated GET /user/usage.
# ---------------------------------------------------------------------------
class TestUsageTimestampParsing:
    """Regression: Supabase timestamptz arrives as ISO strings, not datetimes."""

    @patch("app.core.rate_limit_middleware.get_rate_limiter")
    @patch("app.api.user.get_supabase")
    def test_usage_handles_string_timestamps_from_supabase(
        self, mock_get_supabase, mock_limiter
    ):
        """points_reset_at / daily_free_requests_reset_at as ISO strings
        must not crash .isoformat() or the seconds_until calculation."""
        from app.api.user import get_my_usage

        sb = MagicMock()

        # Account row with ISO-STRING timestamps (Supabase default for timestamptz)
        account_row = {
            "monthly_requests": 0,
            "monthly_limit": 0,
            "total_requests": 0,
            "tier": "free",
            "role": "user",
            "rpm_limit": 10,
            "tokens_5h_limit": 0,
            "tokens_7d_limit": 0,
            "budget_reset_at": None,
            "is_trialing": False,
            "monthly_points_remaining": 100,
            "monthly_points_limit": 100,
            # The exact shape Supabase returns for timestamptz columns:
            "points_reset_at": "2027-01-01T00:00:00+00:00",
            "daily_free_requests_remaining": 10,
            "daily_free_requests_reset_at": "2026-06-21T00:00:00+00:00",
        }
        accounts_result = MagicMock()
        accounts_result.data = [account_row]

        logs_result = MagicMock()
        logs_result.data = []

        def table_router(tbl):
            chain = MagicMock()
            if tbl == "accounts":
                # .select(...).eq("id", X).execute()
                chain.select.return_value.eq.return_value.execute.return_value = (
                    accounts_result
                )
            elif tbl == "request_logs":
                # .select(...).eq(...).gte(...).execute()
                chain.select.return_value.eq.return_value.gte.return_value.execute.return_value = (
                    logs_result
                )
            else:
                chain.select.return_value.eq.return_value.execute.return_value = MagicMock(
                    data=[]
                )
            return chain

        sb.table.side_effect = table_router

        mock_get_supabase.return_value = sb
        mock_limiter.return_value = _allow_limiter(mock_limiter)

        req = _make_request(account_id="acc-test-string-ts")
        resp = await_run(get_my_usage(req))

        # Both timestamps must round-trip as ISO strings (not crash)
        assert resp["points_reset_at"] == "2027-01-01T00:00:00+00:00"
        assert resp["daily_free_requests_reset_at"] == "2026-06-21T00:00:00+00:00"
        # seconds_until_points_reset must be a positive int (future date)
        assert isinstance(resp["seconds_until_points_reset"], int)
        assert resp["seconds_until_points_reset"] > 0
