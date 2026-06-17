"""Static checks for schema.sql security posture.

These tests don't hit a database — they parse schema.sql and verify that
every SECURITY DEFINER function declares SET search_path. This is a
defense-in-depth check that catches a whole class of privilege-escalation
bugs at CI time, before they ever reach Supabase.

We also assert that:
  - monthly_usage and provider_health views use `security_invoker = true`
  - invitation_codes has RLS enabled

This is not a substitute for actually applying the migration and running
`\df+` in psql, but it catches the most common regressions: someone adds
a new SECURITY DEFINER function and forgets the search_path.
"""
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = REPO_ROOT / "backend" / "supabase" / "schema.sql"


@pytest.fixture(scope="module")
def schema_text() -> str:
    return SCHEMA_PATH.read_text(encoding="utf-8")


def _strip_comments(text: str) -> str:
    """Strip SQL line comments (-- ...) so they don't confuse the regex.
    Block comments /* ... */ are also stripped. The schema doesn't use
    them, but be defensive."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    text = re.sub(r"--[^\n]*", "", text)
    return text


def _all_security_definer_blocks(text: str) -> list[str]:
    """Return each `$$ LANGUAGE plpgsql SECURITY DEFINER [SET search_path...]`
    block from the schema.

    Note: we look for SECURITY DEFINER followed by a language clause, then
    greedily capture any postfix (`SET search_path`, `;`, etc.) up to the
    next `;` or end of function body.
    """
    pattern = re.compile(
        r"\$\$\s+LANGUAGE\s+plpgsql(?:\s+SECURITY\s+DEFINER)?\s*"
        r"(?P<postfix>(?:SET\s+search_path\s*=\s*[^;]+;?)?)",
        re.IGNORECASE,
    )
    return [m.group(0) for m in pattern.finditer(text)]


def _stripped_schema(schema_text: str) -> str:
    return _strip_comments(schema_text)


def test_every_security_definer_has_search_path(schema_text):
    """Every SECURITY DEFINER function must declare SET search_path."""
    text = _stripped_schema(schema_text)
    blocks = _all_security_definer_blocks(text)
    assert blocks, "expected at least one plpgsql LANGUAGE block in schema.sql"

    sd_blocks = [b for b in blocks if "SECURITY DEFINER" in b.upper()]
    assert sd_blocks, "expected at least one SECURITY DEFINER function in schema.sql"

    missing = [
        b.strip().splitlines()[0]
        for b in sd_blocks
        if "search_path" not in b
    ]
    assert not missing, (
        f"the following SECURITY DEFINER blocks are missing SET search_path "
        f"(schema-hijack risk):\n  " + "\n  ".join(missing)
    )


def test_no_grant_execute_to_public_in_schema(schema_text):
    """No `GRANT EXECUTE ... TO PUBLIC` should appear in the schema.
    PUBLIC means every role, including anon. Service-role-only RPC functions
    must be granted to `service_role` explicitly.
    """
    text = _stripped_schema(schema_text)
    bad = re.findall(
        r"GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+[^;]+\s+TO\s+PUBLIC",
        text,
        re.IGNORECASE,
    )
    assert not bad, (
        f"GRANT EXECUTE ... TO PUBLIC found (anon can call): {bad}"
    )


def test_views_have_security_invoker(schema_text):
    """monthly_usage and provider_health views must declare security_invoker.
    Plain views in Postgres do NOT inherit RLS from underlying tables, so
    anon can read aggregated cross-account data unless security_invoker is
    set (PG15+).
    """
    text = _stripped_schema(schema_text)

    # Extract the body of each CREATE OR REPLACE VIEW ... AS.
    view_pattern = re.compile(
        r"CREATE\s+OR\s+REPLACE\s+VIEW\s+(?P<name>\w+)\b(?P<options>[^;]*?)AS",
        re.IGNORECASE | re.DOTALL,
    )
    views = {m.group("name").lower(): m.group("options") for m in view_pattern.finditer(text)}

    assert "monthly_usage" in views, "monthly_usage view not found in schema.sql"
    assert "provider_health" in views, "provider_health view not found in schema.sql"

    for view_name, options in [("monthly_usage", views["monthly_usage"]),
                                 ("provider_health", views["provider_health"])]:
        assert "security_invoker" in options.lower(), (
            f"view {view_name!r} does not declare security_invoker — anon can read "
            f"aggregated cross-account data via PostgREST"
        )


def test_invitation_codes_rls_enabled(schema_text):
    """invitation_codes must have ALTER TABLE ... ENABLE ROW LEVEL SECURITY.
    Without it, anon can SELECT all codes and harvest beta invites.
    """
    text = _stripped_schema(schema_text)
    pattern = re.compile(
        r"ALTER\s+TABLE\s+invitation_codes\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY",
        re.IGNORECASE,
    )
    assert pattern.search(text), (
        "invitation_codes table does not have ENABLE ROW LEVEL SECURITY — "
        "anon can SELECT all invitation codes (incl. used_count) via PostgREST"
    )


def test_no_plaintext_password_in_schema(schema_text):
    """No hardcoded Supabase DB password (e.g. the previously-leaked
    'sihamdisoudani' string) should appear in the schema. The schema is
    committed to git; any secret here leaks forever.
    """
    # Add other known-leaked strings here as a permanent guard.
    forbidden = [
        "sihamdisoudani",  # the leaked DB password from the prior incident
    ]
    for s in forbidden:
        assert s not in schema_text, (
            f"schema.sql contains a known-leaked secret: {s!r}. Remove immediately "
            f"and rotate the credential."
        )
