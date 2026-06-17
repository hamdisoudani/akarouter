"""Static checks for dependency pinning (PR 19).

Why this matters: the clean-slate infra audit flagged
'backend/pyproject.toml — loose >= version pins, missing cryptography
dep' as HIGH. The original deps were floors like `fastapi>=0.111.0`
which allow ANY future version (including breaking changes and CVEs)
to land in the production image silently.

These tests assert:
1. Every dep in pyproject.toml uses `==` (exact pin), not `>=`/`~=`.
2. `cryptography` is a declared top-level dep (not just transitive).
3. The pinned versions in pyproject.toml and requirements.txt agree.
4. The venv's installed versions match the pins (catches a manual
   `pip install` that didn't update the manifests).
"""
import re
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
PYPROJECT = REPO_ROOT / "pyproject.toml"
REQUIREMENTS = REPO_ROOT / "requirements.txt"


def _normalize(name: str) -> str:
    """Strip extras (e.g. `uvicorn[standard]` -> `uvicorn`) and lowercase."""
    return name.split("[")[0].lower()


def _parse_pyproject_deps() -> dict[str, str]:
    """Return {dep_name: version_spec} from the [project] dependencies block.

    Strips extras like `uvicorn[standard]` to just `uvicorn`.
    """
    text = PYPROJECT.read_text(encoding="utf-8")
    # Find the [project] block, then the dependencies list inside it.
    # Stop at the next [section] header.
    in_dependencies = False
    deps: dict[str, str] = {}
    for line in text.splitlines():
        if line.startswith("dependencies = ["):
            in_dependencies = True
            continue
        if in_dependencies:
            if line.startswith("]"):
                break
            m = re.match(r'\s*"([a-zA-Z0-9_\-\[\]]+?)(==|>=|<=|~=|!=|===)([^"]+)"', line)
            if m:
                name = _normalize(m.group(1))
                deps[name] = m.group(2) + m.group(3)
    return deps


def _parse_requirements() -> dict[str, str]:
    """Return {dep_name: version_spec} from requirements.txt.

    Handles extras like `uvicorn[standard]==0.49.0` by matching the
    version operator (==, >=, etc.) first, then taking the leading
    name+extras prefix.
    """
    deps: dict[str, str] = {}
    for line in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"([a-zA-Z0-9_\-\[\]]+?)(==|>=|<=|~=|!=|===)(.+)", line)
        if m:
            name = _normalize(m.group(1))
            deps[name] = m.group(2) + m.group(3)
    return deps


def test_every_dep_is_exact_pinned_in_pyproject():
    """Every dep must use `==`, not `>=`/`<=`/`~=`/`!=`/`===`.

    Floors allow arbitrary future versions, which is incompatible with
    reproducible builds. Catches accidental regression to `>=` after
    a `pip install -U` or a copy-paste from old docs.
    """
    deps = _parse_pyproject_deps()
    bad = {
        name: spec
        for name, spec in deps.items()
        if not spec.startswith("==")
    }
    assert not bad, (
        "the following deps in pyproject.toml are not exact-pinned:\n  "
        + "\n  ".join(f"{n} {s}" for n, s in sorted(bad.items()))
        + "\n\nPin to `==X.Y.Z` for reproducible builds."
    )


def test_every_dep_is_exact_pinned_in_requirements():
    """Same check for requirements.txt — the file the Dockerfile reads."""
    deps = _parse_requirements()
    bad = {
        name: spec
        for name, spec in deps.items()
        if not spec.startswith("==")
    }
    assert not bad, (
        "the following deps in requirements.txt are not exact-pinned:\n  "
        + "\n  ".join(f"{n} {s}" for n, s in sorted(bad.items()))
        + "\n\nPin to `==X.Y.Z` for reproducible builds."
    )


def test_cryptography_is_explicit_top_level_dep():
    """`cryptography` must be a top-level dep, not just transitive.

    app/core/router.py uses Fernet for at-rest encryption of hosted
    agent API keys. If a future daytona upgrade drops the cryptography
    dep, our at-rest encryption silently breaks at install time
    (ImportError on first request). Owning the version makes the
    contract explicit.
    """
    deps = _parse_pyproject_deps()
    assert "cryptography" in deps, (
        "cryptography must be declared in pyproject.toml as a top-level "
        "dependency. It is used directly by app/core/router.py for Fernet "
        "at-rest encryption of hosted agent API keys."
    )


def test_pyproject_and_requirements_agree_on_versions():
    """The version pins in pyproject.toml and requirements.txt must match.

    Catches drift where someone updates one but forgets the other.
    Both files must be the source of truth for the same set of pinned
    versions.
    """
    pyproject = _parse_pyproject_deps()
    requirements = _parse_requirements()
    only_in_pyproject = set(pyproject) - set(requirements)
    only_in_requirements = set(requirements) - set(pyproject)
    assert not only_in_pyproject, (
        f"deps only in pyproject.toml (missing from requirements.txt): "
        f"{sorted(only_in_pyproject)}"
    )
    assert not only_in_requirements, (
        f"deps only in requirements.txt (missing from pyproject.toml): "
        f"{sorted(only_in_requirements)}"
    )
    mismatched = sorted(
        n for n in pyproject
        if pyproject[n] != requirements.get(n)
    )
    assert not mismatched, (
        "version mismatch between pyproject.toml and requirements.txt:\n  "
        + "\n  ".join(f"{n}: pyproject={pyproject[n]} requirements={requirements[n]}"
                     for n in mismatched)
    )


def test_installed_versions_match_pins():
    """The venv's installed versions must match the pinned versions.

    Catches a manual `pip install <pkg>` (e.g., for debugging) that
    upgraded a dep without updating the manifests. If this test fails,
    regenerate the pins (see pyproject.toml header comment).
    """
    try:
        result = subprocess.run(
            ["pip", "freeze", "--local"],
            capture_output=True, text=True, check=True,
            cwd=REPO_ROOT,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        pytest.skip("pip not available in venv")
    installed = {}
    for line in result.stdout.splitlines():
        if "==" in line and not line.startswith("#"):
            name, _, version = line.partition("==")
            installed[name.strip().lower()] = version.strip()
    expected = _parse_requirements()
    mismatched = sorted(
        n for n in expected
        if n in installed and installed[n] != expected[n].lstrip("=")
    )
    # It's OK if a pinned dep isn't installed (e.g., on a minimal
    # CI image), but if it IS installed, the version must match.
    assert not mismatched, (
        "installed versions don't match pinned versions:\n  "
        + "\n  ".join(f"{n}: installed={installed[n]} pinned={expected[n]}"
                     for n in mismatched)
        + "\n\nRun `pip install -r requirements.txt` or regenerate pins."
    )


def test_dev_deps_are_in_optional_group():
    """Dev tools (pytest, ruff, mypy) must NOT be in the production
    `dependencies` block. They belong in `optional-dependencies.dev`.

    Catches accidental prod dep on a test-only tool (would bloat the
    image and possibly introduce a vuln).
    """
    deps = _parse_pyproject_deps()
    forbidden = {"pytest", "pytest-asyncio", "ruff", "mypy"}
    leaked = forbidden & set(deps)
    assert not leaked, (
        f"dev-only tools declared as production deps in pyproject.toml: "
        f"{sorted(leaked)}. Move to [project.optional-dependencies.dev]."
    )
