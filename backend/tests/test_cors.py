from unittest.mock import patch
import pytest

@patch("app.core.config.settings.app_env", "production")
@patch("app.core.config.settings.cors_origins", ["https://myfrontend.com"])
def test_cors_production_setup():
    import sys
    import importlib
    if "app.main" in sys.modules:
        importlib.reload(sys.modules["app.main"])
    from fastapi.middleware.cors import CORSMiddleware
    from app.main import app
    
    cors_middleware = None
    for middleware in app.user_middleware:
        if middleware.cls == CORSMiddleware:
            cors_middleware = middleware
            break
            
    assert cors_middleware is not None
    # We test that custom origins are specified, and credentials are True (since origins are not wildcard)
    assert cors_middleware.kwargs["allow_origins"] == ["https://myfrontend.com"]
    assert cors_middleware.kwargs["allow_credentials"] is True

@patch("app.core.config.settings.app_env", "production")
@patch("app.core.config.settings.cors_origins", ["*"])
def test_cors_production_wildcard_no_credentials():
    from fastapi.middleware.cors import CORSMiddleware
    # Re-import main or test the logic directly
    from app.core.config import settings
    cors_origins = [str(o) for o in settings.cors_origins] if settings.cors_origins else ["*"]
    allow_credentials = "*" not in cors_origins
    
    assert cors_origins == ["*"]
    assert allow_credentials is False


def test_cors_origins_env_parsing():
    import os
    from app.core.config import Settings
    
    # Backup existing environment variable
    orig_env = os.environ.get("AKAROUTER_CORS_ORIGINS")
    
    try:
        # 1. Comma separated
        os.environ["AKAROUTER_CORS_ORIGINS"] = "https://example1.com, https://example2.com"
        settings = Settings()
        assert settings.cors_origins == ["https://example1.com", "https://example2.com"]
        
        # 2. JSON list
        os.environ["AKAROUTER_CORS_ORIGINS"] = '["https://json1.com", "https://json2.com"]'
        settings = Settings()
        assert settings.cors_origins == ["https://json1.com", "https://json2.com"]
    finally:
        # Restore or clean up
        if orig_env is not None:
            os.environ["AKAROUTER_CORS_ORIGINS"] = orig_env
        elif "AKAROUTER_CORS_ORIGINS" in os.environ:
            del os.environ["AKAROUTER_CORS_ORIGINS"]

