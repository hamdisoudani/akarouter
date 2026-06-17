"""Security headers middleware for the FastAPI backend.

Applies a baseline of HTTP response headers on every response, in three tiers:

  1. Always-on (transport-level hardening):
       - Strict-Transport-Security (HSTS) in production only
       - X-Content-Type-Options: nosniff
       - Referrer-Policy: no-referrer
       - Permissions-Policy: deny all powerful features by default

  2. Context-aware (varies by route family):
       - X-Frame-Options: DENY everywhere except /v1/* (which serves
         JSON; the directive is irrelevant for non-HTML but still safe
         to set)
       - Content-Security-Policy: restrictive on JSON APIs (the CSP
         protects any future response that contains HTML, e.g. an
         OpenAPI swagger UI). The default-src 'none' blocks everything
         so even if a response is rendered as HTML, no script/style
         can execute.

  3. Server hygiene:
       - Server: stripped (don't leak uvicorn/python)
       - X-Powered-By: stripped
       - X-Request-ID: echoed if the client supplied one, generated
         otherwise (handled by the request_id middleware in PR 14,
         not here)

Why a custom middleware instead of `secure` (the third-party Helmet
port) — it has no FastAPI integration and brings in Starlette baggage.
Our needs are 6 headers, all of which are one-line static strings.

Why this is safe to add to a JSON API:
  - All headers we set are response headers, not request headers.
    Browsers only act on a subset (HSTS, CSP, X-Frame-Options, etc.)
    for responses they render. A JSON 200 sees no policy enforcement.
  - Setting them on a JSON API is belt-and-suspenders: cheap, can't
    hurt, and protects the one response in the system that is HTML —
    the FastAPI /docs Swagger UI page.
"""
from __future__ import annotations

import logging
from typing import Iterable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from app.core.config import settings

logger = logging.getLogger(__name__)


# Headers we always strip from the response (server fingerprinting).
_STRIPPED_HEADERS = frozenset({"server", "x-powered-by"})


def _build_csp_for_path(path: str) -> str:
    """Build a Content-Security-Policy appropriate for the route.

    The policy is intentionally tight. AKAROUTER returns JSON from
    /v1/* and /user/*, so 'default-src 'none'' is correct: even if
    a response is rendered as HTML by a browser, nothing can execute.

    For the OpenAPI docs UI at /docs and /openapi.json, we relax it
    to allow the swagger-ui CDN. The docs are public in dev and
    restricted to admins in production via the auth middleware; if
    docs are disabled in production, the relaxed policy never
    fires.
    """
    if path.startswith(("/docs", "/openapi", "/redoc")):
        # Swagger UI: needs inline styles + scripts from a single CDN.
        return (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "img-src 'self' data: https:; "
            "font-src 'self' https://cdn.jsdelivr.net; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )
    # Default: total lockdown. JSON APIs should never render HTML.
    return "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"


def _build_headers_for_request(path: str) -> dict[str, str]:
    """Build the static set of security headers for a given request path.

    HSTS is only emitted in production. Adding HSTS to a dev environment
    that uses http://localhost tells the browser to refuse plain HTTP
    for a year — which breaks dev iteration.
    """
    headers: dict[str, str] = {
        # Browser sniff protection. Stops MIME-type confusion attacks.
        "X-Content-Type-Options": "nosniff",
        # Don't leak the URL we came from to upstream services.
        "Referrer-Policy": "no-referrer",
        # Deny every powerful browser feature by default. Tighten
        # further when a specific use case appears.
        "Permissions-Policy": (
            "accelerometer=(), camera=(), geolocation=(), gyroscope=(), "
            "magnetometer=(), microphone=(), payment=(), usb=(), "
            "interest-cohort=()"
        ),
        # Clickjacking protection. DENY for everyone — we never embed
        # in a frame.
        "X-Frame-Options": "DENY",
        # Cross-origin isolation (defense in depth alongside CORS).
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-origin",
        # Disable DNS prefetch leak.
        "X-DNS-Prefetch-Control": "off",
    }

    if settings.app_env == "production":
        # HSTS: force HTTPS for one year, including subdomains. Once
        # a browser sees this, plain-HTTP requests to this domain are
        # refused. Be sure TLS is set up before shipping.
        # `preload` is opt-in for the HSTS preload list; not setting
        # it because that's a separate submission to hstspreload.org.
        headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    # CSP varies by path (docs UI needs more permissive).
    headers["Content-Security-Policy"] = _build_csp_for_path(path)

    return headers


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to every response.

    - Strips Server / X-Powered-By (server fingerprinting)
    - Adds the headers in `_build_headers_for_request`
    - NEVER overwrites a header that the route handler set explicitly
      (e.g. a per-route X-Robots-Tag or Cache-Control). The handler's
      choice wins.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)
        # Logged once at construction so the operator can confirm the
        # middleware is loaded (the absence of these headers in prod
        # is a silent regression we want to catch).
        logger.info("Security headers middleware initialized (env=%s)", settings.app_env)

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)

        # Build the static header set for this path.
        path = request.url.path
        new_headers = _build_headers_for_request(path)

        # Apply each new header, never overwriting an existing one.
        for name, value in new_headers.items():
            if name not in response.headers:
                response.headers[name] = value

        # Strip server fingerprint headers if the underlying server
        # set them. Use lowercase since HTTP headers are case-insensitive
        # and Starlette normalizes to lowercase.
        for name in _STRIPPED_HEADERS:
            if name in response.headers:
                del response.headers[name]

        return response
