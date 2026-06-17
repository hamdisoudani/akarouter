"""Tests for app.core.audit helper.

These tests verify:
- `audit()` calls write_audit_log RPC with the correct payload
- `_extract_request_meta` correctly pulls IP from X-Forwarded-For + client.host
- Fail-soft semantics: audit() does not raise when RPC fails
- audit_strict() raises when RPC returns no data
"""
from unittest.mock import MagicMock, patch

import pytest

from app.core.audit import audit, audit_strict, _extract_request_meta


def _fake_request(xff: str = None, client_host: str = None, ua: str = None) -> MagicMock:
    req = MagicMock()
    headers = {}
    if xff:
        headers["x-forwarded-for"] = xff
    if ua:
        headers["user-agent"] = ua
    req.headers = headers
    if client_host:
        client = MagicMock()
        client.host = client_host
        req.client = client
    else:
        req.client = None
    return req


# ---------------------------------------------------------------------------
# _extract_request_meta
# ---------------------------------------------------------------------------


def test_extract_request_meta_xff_first_ip():
    """When X-Forwarded-For has multiple IPs, take the leftmost (client)."""
    req = _fake_request(xff="1.2.3.4, 10.0.0.1, 10.0.0.2", ua="Mozilla/5.0")
    meta = _extract_request_meta(req)
    assert meta["ip_address"] == "1.2.3.4"
    assert meta["user_agent"] == "Mozilla/5.0"


def test_extract_request_meta_falls_back_to_client_host():
    """No XFF header → use request.client.host."""
    req = _fake_request(client_host="5.6.7.8")
    meta = _extract_request_meta(req)
    assert meta["ip_address"] == "5.6.7.8"
    assert "user_agent" not in meta


def test_extract_request_meta_none_request():
    """None request → empty meta, no crash."""
    assert _extract_request_meta(None) == {}


def test_extract_request_meta_no_client_no_xff():
    """No XFF, no client → empty meta."""
    req = _fake_request()
    assert _extract_request_meta(req) == {}


# ---------------------------------------------------------------------------
# audit() — fail-soft happy path
# ---------------------------------------------------------------------------


@patch("app.core.audit.get_supabase")
def test_audit_calls_rpc_with_correct_payload(mock_get_supabase):
    mock_supabase = MagicMock()
    mock_supabase.rpc.return_value.execute.return_value = MagicMock(data=42)
    mock_get_supabase.return_value = mock_supabase

    result = audit(
        action="tier.upgrade",
        target_type="account",
        target_id="acc-123",
        metadata={"from": "free", "to": "ultra"},
    )

    assert result == 42
    mock_supabase.rpc.assert_called_once()
    call = mock_supabase.rpc.call_args
    assert call.args[0] == "write_audit_log"
    payload = call.args[1]  # rpc(name, payload) — second positional arg
    assert payload["p_action"] == "tier.upgrade"
    assert payload["p_target_type"] == "account"
    assert payload["p_target_id"] == "acc-123"
    assert payload["p_metadata"] == {"from": "free", "to": "ultra"}


@patch("app.core.audit.get_supabase")
def test_audit_includes_request_metadata(mock_get_supabase):
    mock_supabase = MagicMock()
    mock_supabase.rpc.return_value.execute.return_value = MagicMock(data=1)
    mock_get_supabase.return_value = mock_supabase

    req = _fake_request(xff="9.9.9.9", ua="TestAgent/1.0")
    audit(action="x", target_type="y", request=req, request_id="req-abc")

    payload = mock_supabase.rpc.call_args.args[1]
    assert payload["p_ip_address"] == "9.9.9.9"
    assert payload["p_user_agent"] == "TestAgent/1.0"
    assert payload["p_request_id"] == "req-abc"


# ---------------------------------------------------------------------------
# audit() — fail-soft on errors
# ---------------------------------------------------------------------------


@patch("app.core.audit.get_supabase")
def test_audit_does_not_raise_when_rpc_fails(mock_get_supabase):
    """audit() must NEVER raise. Failing the audit write must not fail the calling action."""
    mock_get_supabase.side_effect = Exception("Supabase down")
    result = audit(action="x", target_type="y")
    assert result is None


@patch("app.core.audit.get_supabase")
def test_audit_returns_none_on_empty_data(mock_get_supabase):
    """If the RPC returns no data (e.g., trigger raised), don't raise — just return None."""
    mock_supabase = MagicMock()
    mock_supabase.rpc.return_value.execute.return_value = MagicMock(data=None)
    mock_get_supabase.return_value = mock_supabase
    result = audit(action="x", target_type="y")
    assert result is None


# ---------------------------------------------------------------------------
# audit_strict() — fail-loud variant
# ---------------------------------------------------------------------------


@patch("app.core.audit.get_supabase")
def test_audit_strict_raises_on_no_data(mock_get_supabase):
    mock_supabase = MagicMock()
    mock_supabase.rpc.return_value.execute.return_value = MagicMock(data=None)
    mock_get_supabase.return_value = mock_supabase
    with pytest.raises(RuntimeError, match="audit_log write returned no data"):
        audit_strict(action="x", target_type="y")


@patch("app.core.audit.get_supabase")
def test_audit_strict_raises_on_rpc_exception(mock_get_supabase):
    mock_get_supabase.side_effect = Exception("DB down")
    with pytest.raises(Exception, match="DB down"):
        audit_strict(action="x", target_type="y")


@patch("app.core.audit.get_supabase")
def test_audit_strict_returns_id_on_success(mock_get_supabase):
    mock_supabase = MagicMock()
    mock_supabase.rpc.return_value.execute.return_value = MagicMock(data=99)
    mock_get_supabase.return_value = mock_supabase
    assert audit_strict(action="x", target_type="y") == 99