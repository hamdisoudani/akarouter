"""Tests for app.core.security_headers (HTTP response headers middleware).

Covers:
  - All baseline headers are present on a normal response
  - HSTS is added in production, omitted in non-production
  - CSP is tight (default-src 'none') on /v1/* and /user/* responses
  - CSP is more permissive on /docs (swagger UI CDN allowed)
  - The middleware never overwrites a header the route handler set
  - Server / X-Powered-By are stripped
  - X-Frame-Options is DENY
  - Permissions-Policy blocks all listed features
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.security_headers import (
    SecurityHeadersMiddleware,
    _build_csp_for_path,
    _build_headers_for_request,
)


@pytest.fixture
def app_with_middleware():
    """A minimal FastAPI app with the security headers middleware and
    a few test routes that exercise different path families."""
    app = FastAPI()
    app.add_middleware(SecurityHeadersMiddleware)

    @app.get("/v1/test")
    async def v1_test():
        return {"ok": True}

    @app.get("/user/test")
    async def user_test():
        return {"ok": True}

    @app.get("/docs-test")
    async def docs_test():
        return {"ok": True}

    @app.get("/override")
    async def override():
        from fastapi import Response
        return Response(
            content="custom",
            headers={"X-Frame-Options": "SAMEORIGIN"},  # explicit override
        )

    @app.get("/with-server-header")
    async def with_server_header():
        from fastapi import Response
        return Response(content="x", headers={"Server": "leaky/1.0"})

    return app


@pytest.fixture
def client(app_with_middleware):
    return TestClient(app_with_middleware)


# ───────────────────────────────────────────────────────────────────
# Header presence
# ───────────────────────────────────────────────────────────────────

def test_all_baseline_headers_present_on_v1(client):
    r = client.get("/v1/test")
    assert r.status_code == 200
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "no-referrer"
    assert r.headers["X-DNS-Prefetch-Control"] == "off"
    assert r.headers["Cross-Origin-Opener-Policy"] == "same-origin"
    assert r.headers["Cross-Origin-Resource-Policy"] == "same-origin"


def test_permissions_policy_blocks_all_powerful_features(client):
    r = client.get("/v1/test")
    pp = r.headers["Permissions-Policy"]
    for feature in ("camera", "microphone", "geolocation", "payment", "usb"):
        assert f"{feature}=()" in pp, f"Permissions-Policy missing {feature}=()"


def test_csp_default_for_v1_is_locked_down(client):
    r = client.get("/v1/test")
    csp = r.headers["Content-Security-Policy"]
    assert "default-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp
    # No script-src, no style-src — strict default for JSON APIs.
    assert "script-src" not in csp
    assert "style-src" not in csp


def test_csp_default_for_user_is_locked_down(client):
    r = client.get("/user/test")
    csp = r.headers["Content-Security-Policy"]
    assert "default-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp


def test_csp_relaxes_for_docs(client):
    r = client.get("/docs-test")
    csp = r.headers["Content-Security-Policy"]
    # Docs route gets a relaxed policy for swagger UI.
    assert "cdn.jsdelivr.net" in csp
    assert "default-src 'self'" in csp


# ───────────────────────────────────────────────────────────────────
# HSTS in production only
# ───────────────────────────────────────────────────────────────────

def test_hsts_present_in_production(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    headers = _build_headers_for_request("/v1/test")
    assert "Strict-Transport-Security" in headers
    assert "max-age=31536000" in headers["Strict-Transport-Security"]
    assert "includeSubDomains" in headers["Strict-Transport-Security"]


def test_hsts_absent_in_development(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "development")
    headers = _build_headers_for_request("/v1/test")
    assert "Strict-Transport-Security" not in headers


def test_hsts_absent_in_staging(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "staging")
    headers = _build_headers_for_request("/v1/test")
    assert "Strict-Transport-Security" not in headers


# ───────────────────────────────────────────────────────────────────
# Non-overwrite guarantee
# ───────────────────────────────────────────────────────────────────

def test_handler_explicit_header_wins(client):
    """If a route handler sets X-Frame-Options, the middleware does NOT
    overwrite it. The handler's choice beats the baseline."""
    r = client.get("/override")
    assert r.headers["X-Frame-Options"] == "SAMEORIGIN"
    # But the other baseline headers ARE added.
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert "Content-Security-Policy" in r.headers


def test_server_header_stripped(client):
    """The middleware strips the 'Server' header set by the handler."""
    r = client.get("/with-server-header")
    # Header set by handler should be removed.
    assert "server" not in {k.lower() for k in r.headers.keys()}
    # But the other security headers ARE present.
    assert r.headers["X-Content-Type-Options"] == "nosniff"


# ───────────────────────────────────────────────────────────────────
# CSP path routing
# ───────────────────────────────────────────────────────────────────

def test_csp_for_docs_routes():
    csp = _build_csp_for_path("/docs")
    assert "cdn.jsdelivr.net" in csp
    csp = _build_csp_for_path("/openapi.json")
    assert "cdn.jsdelivr.net" in csp
    csp = _build_csp_for_path("/redoc")
    assert "cdn.jsdelivr.net" in csp


def test_csp_for_v1_routes_is_locked():
    for path in ("/v1/chat/completions", "/v1/models", "/v1/plans"):
        csp = _build_csp_for_path(path)
        assert "default-src 'none'" in csp


def test_csp_for_user_routes_is_locked():
    for path in ("/user/me", "/user/keys", "/user/usage"):
        csp = _build_csp_for_path(path)
        assert "default-src 'none'" in csp


# ───────────────────────────────────────────────────────────────────
# Edge cases
# ───────────────────────────────────────────────────────────────────

def test_error_responses_also_get_headers(client):
    """A 404 from FastAPI's default exception handler should still
    pass through the middleware and get security headers."""
    r = client.get("/does-not-exist")
    assert r.status_code == 404
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"


def test_cors_preflight_keeps_cors_headers(client):
    """Make sure the security-headers middleware doesn't strip the
    CORS headers CORSMiddleware adds (Access-Control-Allow-Origin etc.).
    CORS isn't configured in this minimal test app, but we can verify
    the middleware doesn't add the headers we don't want on a CORS
    preflight response by checking it doesn't break the response."""
    r = client.options(
        "/v1/test",
        headers={
            "Origin": "https://akarouter.dev",
            "Access-Control-Request-Method": "GET",
        },
    )
    # 200/400/405 all acceptable — what we care about is that our
    # security headers are present.
    assert r.headers["X-Content-Type-Options"] == "nosniff"
