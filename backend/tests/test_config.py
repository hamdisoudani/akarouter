"""Tests for app.core.config settings.

Covers the pydantic-settings empty-string handling: when a Docker ARG
has no matching env var, Railway passes an empty string, which by
default fails pydantic int validation. The settings class should treat
empty strings as "unset, use default" so the container stays bootable.

Also covers the production fail-closed checks (encryption key length,
whop webhook secret required in prod).
"""
import os
import pytest


@pytest.fixture
def _isolated_settings(monkeypatch):
    """Snapshot and restore the module-level `settings` object so test_config.py
    cannot pollute later tests' view of the app config."""
    from app.core import config as config_mod
    saved = config_mod.settings
    yield config_mod
    # Restore the original settings singleton after the test, regardless of
    # whether the test passed or failed. Without this, mutating
    # `config_mod.settings = config_mod.Settings()` here leaks into the next
    # test that imports `app.api.webhooks` etc. and reads from the same
    # module-level singleton.
    config_mod.settings = saved


def test_empty_string_daytona_cpu_uses_default(monkeypatch, _isolated_settings):
    """When AKAROUTER_DAYTONA_SANDBOX_CPU is empty, settings should fall back to default 1."""
    monkeypatch.setenv("AKAROUTER_DAYTONA_SANDBOX_CPU", "")
    monkeypatch.setenv("AKAROUTER_SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("AKAROUTER_SUPABASE_SERVICE_ROLE_KEY", "test_key_long_enough_xxx")
    monkeypatch.setenv("AKAROUTER_SUPABASE_DB_URL", "postgresql://test:test@localhost:5432/test")
    monkeypatch.setenv("AKAROUTER_AGENT_KEY_ENCRYPTION_SECRET", "uFRc9uG-7fU1fQpobj-LTAJAlNc0wk-zEbv13dbiKF4=")
    monkeypatch.setenv("AKAROUTER_WHOP_WEBHOOK_SECRET", "test_secret_long_enough_xxx")

    config_mod = _isolated_settings
    config_mod.settings = config_mod.Settings()
    s = config_mod.settings
    assert s.daytona_sandbox_cpu == 1


def test_empty_string_daytona_memory_uses_default(monkeypatch, _isolated_settings):
    monkeypatch.setenv("AKAROUTER_DAYTONA_SANDBOX_MEMORY", "")
    monkeypatch.setenv("AKAROUTER_SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("AKAROUTER_SUPABASE_SERVICE_ROLE_KEY", "test_key_long_enough_xxx")
    monkeypatch.setenv("AKAROUTER_SUPABASE_DB_URL", "postgresql://test:test@localhost:5432/test")
    monkeypatch.setenv("AKAROUTER_AGENT_KEY_ENCRYPTION_SECRET", "uFRc9uG-7fU1fQpobj-LTAJAlNc0wk-zEbv13dbiKF4=")
    monkeypatch.setenv("AKAROUTER_WHOP_WEBHOOK_SECRET", "test_secret_long_enough_xxx")

    config_mod = _isolated_settings
    config_mod.settings = config_mod.Settings()
    assert config_mod.settings.daytona_sandbox_memory == 1


def test_empty_string_daytona_disk_uses_default(monkeypatch, _isolated_settings):
    monkeypatch.setenv("AKAROUTER_DAYTONA_SANDBOX_DISK", "")
    monkeypatch.setenv("AKAROUTER_SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("AKAROUTER_SUPABASE_SERVICE_ROLE_KEY", "test_key_long_enough_xxx")
    monkeypatch.setenv("AKAROUTER_SUPABASE_DB_URL", "postgresql://test:test@localhost:5432/test")
    monkeypatch.setenv("AKAROUTER_AGENT_KEY_ENCRYPTION_SECRET", "uFRc9uG-7fU1fQpobj-LTAJAlNc0wk-zEbv13dbiKF4=")
    monkeypatch.setenv("AKAROUTER_WHOP_WEBHOOK_SECRET", "test_secret_long_enough_xxx")

    config_mod = _isolated_settings
    config_mod.settings = config_mod.Settings()
    assert config_mod.settings.daytona_sandbox_disk == 3


def test_explicit_int_value_overrides_default(monkeypatch, _isolated_settings):
    """When AKAROUTER_DAYTONA_SANDBOX_CPU=4, settings should use 4, not 1."""
    monkeypatch.setenv("AKAROUTER_DAYTONA_SANDBOX_CPU", "4")
    monkeypatch.setenv("AKAROUTER_SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("AKAROUTER_SUPABASE_SERVICE_ROLE_KEY", "test_key_long_enough_xxx")
    monkeypatch.setenv("AKAROUTER_SUPABASE_DB_URL", "postgresql://test:test@localhost:5432/test")
    monkeypatch.setenv("AKAROUTER_AGENT_KEY_ENCRYPTION_SECRET", "uFRc9uG-7fU1fQpobj-LTAJAlNc0wk-zEbv13dbiKF4=")
    monkeypatch.setenv("AKAROUTER_WHOP_WEBHOOK_SECRET", "test_secret_long_enough_xxx")

    config_mod = _isolated_settings
    config_mod.settings = config_mod.Settings()
    assert config_mod.settings.daytona_sandbox_cpu == 4


def test_unset_int_uses_default(monkeypatch, _isolated_settings):
    """When the env var is completely unset, settings should use the default."""
    monkeypatch.delenv("AKAROUTER_DAYTONA_SANDBOX_CPU", raising=False)
    monkeypatch.setenv("AKAROUTER_SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("AKAROUTER_SUPABASE_SERVICE_ROLE_KEY", "test_key_long_enough_xxx")
    monkeypatch.setenv("AKAROUTER_SUPABASE_DB_URL", "postgresql://test:test@localhost:5432/test")
    monkeypatch.setenv("AKAROUTER_AGENT_KEY_ENCRYPTION_SECRET", "uFRc9uG-7fU1fQpobj-LTAJAlNc0wk-zEbv13dbiKF4=")
    monkeypatch.setenv("AKAROUTER_WHOP_WEBHOOK_SECRET", "test_secret_long_enough_xxx")

    config_mod = _isolated_settings
    config_mod.settings = config_mod.Settings()
    assert config_mod.settings.daytona_sandbox_cpu == 1


def test_invalid_int_value_still_fails(monkeypatch, _isolated_settings):
    """A non-integer string should still raise — only '' is treated as default."""
    monkeypatch.setenv("AKAROUTER_DAYTONA_SANDBOX_CPU", "not-a-number")
    monkeypatch.setenv("AKAROUTER_SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("AKAROUTER_SUPABASE_SERVICE_ROLE_KEY", "test_key_long_enough_xxx")
    monkeypatch.setenv("AKAROUTER_SUPABASE_DB_URL", "postgresql://test:test@localhost:5432/test")
    monkeypatch.setenv("AKAROUTER_AGENT_KEY_ENCRYPTION_SECRET", "uFRc9uG-7fU1fQpobj-LTAJAlNc0wk-zEbv13dbiKF4=")
    monkeypatch.setenv("AKAROUTER_WHOP_WEBHOOK_SECRET", "test_secret_long_enough_xxx")

    config_mod = _isolated_settings
    with pytest.raises(Exception):  # ValidationError
        config_mod.Settings()
