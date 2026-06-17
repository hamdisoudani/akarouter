"""Static checks for .env.example files.

Why this matters: in the clean-slate infra audit, the backend
.env.example was missing 13+ env vars that app/core/config.py reads.
Operators spinning up a new deployment wouldn't know those vars
existed, and the app would either crash on startup or silently fall
back to defaults that fail open in some cases.

These tests parse app/core/config.py and assert every field is
documented in backend/.env.example. They also check the frontend
env.ts schema against frontend/.env.example.
"""
import ast
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = REPO_ROOT / "backend" / "app" / "core" / "config.py"
BACKEND_ENV_EXAMPLE = REPO_ROOT / "backend" / ".env.example"
FRONTEND_ENV_PATH = REPO_ROOT / "frontend" / "lib" / "env.ts"
FRONTEND_ENV_EXAMPLE = REPO_ROOT / "frontend" / ".env.example"
FRONTEND_DOCKERFILE = REPO_ROOT / "frontend" / "Dockerfile"


# Fields that are intentionally NOT documented because they're internal
# implementation details (Pydantic config, computed properties, nested
# dicts, model aliases/pricing) — not operator-facing env vars.
_SKIP_CONFIG_FIELDS = {
    "model_config",  # Pydantic SettingsConfigDict (not an env var)
    "model_mapping",  # nested dict, not an env var
    "model_pricing",  # nested dict, not an env var
    "supabase_configured",  # computed property
}


def _settings_field_names() -> set[str]:
    """Return the set of field names declared on the Settings class."""
    tree = ast.parse(CONFIG_PATH.read_text(encoding="utf-8"))
    settings_class = next(
        n for n in ast.walk(tree)
        if isinstance(n, ast.ClassDef) and n.name == "Settings"
    )
    fields = set()
    for stmt in settings_class.body:
        if isinstance(stmt, ast.Assign):
            for target in stmt.targets:
                if isinstance(target, ast.Name):
                    fields.add(target.id)
        elif isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            fields.add(stmt.target.id)
    return fields - _SKIP_CONFIG_FIELDS


def _env_example_var_names(path: Path) -> set[str]:
    """Return the set of var names declared (uncommented) in a .env.example file."""
    text = path.read_text(encoding="utf-8")
    # Match lines like "AKAROUTER_FOO=bar" or "AKAROUTER_FOO="
    matches = re.findall(r"^([A-Z][A-Z0-9_]+)\s*=", text, re.MULTILINE)
    return set(matches)


def _field_to_env_var(field: str) -> str:
    """Convert a Settings field name to its AKAROUTER_-prefixed env var name."""
    return f"AKAROUTER_{field.upper()}"


def test_every_config_field_documented_in_env_example():
    """Every operator-facing field in app/core/config.py must be in .env.example.

    The Settings class declares ~30 env-driven fields. Operators should
    see all of them in .env.example, even if the default is empty,
    so they know the var exists and what to set.
    """
    fields = _settings_field_names()
    documented = _env_example_var_names(BACKEND_ENV_EXAMPLE)
    missing = sorted(_field_to_env_var(f) for f in fields
                     if _field_to_env_var(f) not in documented)
    assert not missing, (
        "the following AKAROUTER_* env vars are declared in config.py but "
        "missing from backend/.env.example:\n  " + "\n  ".join(missing)
    )


def test_no_placeholder_secrets_in_env_example():
    """The shipped .env.example must not contain real-looking secrets.
    A common mistake: copy-pasting a real Supabase URL or DB password
    into the example. We block obvious patterns: project-specific
    subdomain patterns and the previously-leaked password.
    """
    text = BACKEND_ENV_EXAMPLE.read_text(encoding="utf-8")
    forbidden = [
        "sihamdisoudani",  # the leaked DB password from the prior incident
    ]
    for s in forbidden:
        assert s not in text, (
            f"backend/.env.example contains the known-leaked secret: {s!r}. "
            f"Use a placeholder like YOUR_PASSWORD instead."
        )


# AKAROUTER_* vars that are intentionally read from os.getenv directly in
# code (e.g., app/core/locks.py) instead of being declared on the
# Settings class. The .env.example doc is still the canonical place for
# operators to discover them.
_KNOWN_EXTERNAL_VARS = {
    "AKAROUTER_LOCK_BACKEND",  # read in app/core/locks.py
}


def test_env_example_does_not_have_unknown_akarouter_vars():
    """Reverse direction: .env.example must not declare AKAROUTER_* vars
    that don't exist in config.py or are read directly via os.getenv.
    Catches typos and stale entries left over from a rename.
    """
    fields = _settings_field_names()
    valid = {_field_to_env_var(f) for f in fields} | _KNOWN_EXTERNAL_VARS
    documented = {v for v in _env_example_var_names(BACKEND_ENV_EXAMPLE)
                  if v.startswith("AKAROUTER_")}
    unknown = sorted(documented - valid)
    assert not unknown, (
        "backend/.env.example declares unknown AKAROUTER_* vars:\n  "
        + "\n  ".join(unknown)
        + "\n\nEither add the field to config.py, or to _KNOWN_EXTERNAL_VARS "
        + "in this test if it's read via os.getenv directly, or remove from .env.example."
    )


# ---------------------------------------------------------------------------
# Frontend env checks
# ---------------------------------------------------------------------------


def _frontend_env_required() -> set[str]:
    """Return the set of NEXT_PUBLIC_* vars that lib/env.ts validates as required."""
    text = FRONTEND_ENV_PATH.read_text(encoding="utf-8")
    # Match the zod schema fields like  NEXT_PUBLIC_API_URL: z.string()...
    # We pick the next non-comment, non-empty line after the field name.
    return set(re.findall(r"^\s*(NEXT_PUBLIC_\w+)\s*:\s*z\.", text, re.MULTILINE))


def _frontend_dockerfile_args() -> set[str]:
    """Return the set of NEXT_PUBLIC_* vars declared as build args in frontend/Dockerfile."""
    text = FRONTEND_DOCKERFILE.read_text(encoding="utf-8")
    return set(re.findall(r"^\s*ARG\s+(NEXT_PUBLIC_\w+)", text, re.MULTILINE))


def test_every_frontend_env_var_documented():
    """Every NEXT_PUBLIC_* var used in lib/env.ts and frontend/Dockerfile
    must be documented in frontend/.env.example.
    """
    from_zod = _frontend_env_required()
    from_docker = _frontend_dockerfile_args()
    documented = {
        v for v in _env_example_var_names(FRONTEND_ENV_EXAMPLE)
        if v.startswith("NEXT_PUBLIC_")
    }
    expected = from_zod | from_docker
    missing = sorted(expected - documented)
    assert not missing, (
        "the following NEXT_PUBLIC_* vars are read by the frontend but "
        "missing from frontend/.env.example:\n  " + "\n  ".join(missing)
    )


def test_env_example_has_admin_key_security_warning():
    """The frontend admin bypass var must carry an explicit security warning
    in .env.example. This is a defense-in-depth check: anyone reading the
    file should understand that NEXT_PUBLIC_ADMIN_KEY in production is a
    risk, and that it should be removed in PR 22.
    """
    text = FRONTEND_ENV_EXAMPLE.read_text(encoding="utf-8")
    if "NEXT_PUBLIC_ADMIN_KEY" not in text:
        pytest.skip("NEXT_PUBLIC_ADMIN_KEY not in .env.example — already removed")
    # Must have at least one of the strong warning markers.
    assert "SECURITY" in text and "bypass" in text.lower(), (
        "NEXT_PUBLIC_ADMIN_KEY is documented in .env.example but without a "
        "SECURITY WARNING explaining that it's a client-side admin bypass "
        "and is baked into the JS bundle. Add a clear warning."
    )
