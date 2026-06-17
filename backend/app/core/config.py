"""AKAROUTER Backend Configuration."""
from typing import Optional, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        env_prefix="AKAROUTER_",
    )

    # App
    app_env: str = "development"
    port: int = 8000

    # Supabase
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_db_url: str = ""

    # Nous/Hermes OAuth
    nous_api_base: str = "https://inference-api.nousresearch.com/v1"
    nous_client_id: str = "hermes-cli"
    nous_scope: str = "inference:invoke"
    nous_device_code_url: str = "https://portal.nousresearch.com/api/oauth/device/code"
    nous_token_url: str = "https://portal.nousresearch.com/api/oauth/token"
    token_refresh_skew: int = 120
    refresh_lock_ttl: int = 30
    max_concurrent_per_account: int = 12

    # Daytona integration
    daytona_api_base: str = "https://app.daytona.io/api"
    daytona_api_key: str = ""                     # dtn_... key
    daytona_sandbox_cpu: int = 1
    daytona_sandbox_memory: int = 1               # GB
    daytona_sandbox_disk: int = 3                 # GB
    public_backend_url: Optional[str] = None      # ngrok or other public base URL for VMs to hit backend

    # Agent limits
    max_agents_free: int = 1
    max_agents_pro: int = 3
    max_agents_enterprise: int = 10

    # Encryption key for storing raw API keys (must be a 32-byte url-safe base64 key for Fernet)
    # REQUIRED in production — app will fail to encrypt/decrypt if empty
    agent_key_encryption_secret: str = ""

    # Whop Integration Settings
    whop_api_key: str = ""
    whop_webhook_secret: str = ""
    whop_company_id: str = ""
    whop_plan_starter: str = ""
    whop_plan_pro: str = ""
    whop_plan_ultra: str = ""

    # CORS Origins
    cors_origins: Union[str, list[str]] = [
        "http://localhost:3000",
        "https://akarouter.dev",
        "https://akarouter-frontend-production.up.railway.app",
    ]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, list[str]]) -> list[str]:
        import json
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed]
            except json.JSONDecodeError:
                pass
            return [item.strip() for item in v.split(",") if item.strip()]
        elif isinstance(v, list):
            return [str(item).strip() for item in v]
        return v



    # Model mapping: alias -> upstream
    model_mapping: dict[str, str] = {
        "akarouter-pro": "stepfun/step-3.7-flash:free",
        "akarouter-large": "openrouter/owl-alpha",
        "akarouter-flash": "nvidia/nemotron-3-ultra:free",
    }

    # Model pricing: input and output cost per 1M tokens in USD
    model_pricing: dict[str, dict[str, float]] = {
        "akarouter-pro": {
            "input_cost_per_million": 0.20,
            "output_cost_per_million": 0.80,
        },
        "akarouter-large": {
            "input_cost_per_million": 0.10,
            "output_cost_per_million": 0.40,
        },
        "akarouter-flash": {
            "input_cost_per_million": 0.05,
            "output_cost_per_million": 0.15,
        },
        "default": {
            "input_cost_per_million": 0.10,
            "output_cost_per_million": 0.30,
        }
    }

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    def resolve_model(self, model_alias: str) -> str:
        """Map AkaRouter model names to upstream model IDs."""
        return self.model_mapping.get(model_alias, model_alias)

    def calculate_cost(self, model_alias: str, prompt_tokens: int, completion_tokens: int) -> float:
        """Calculate request cost in USD."""
        pricing = self.model_pricing.get(model_alias, self.model_pricing["default"])
        input_cost = (prompt_tokens / 1_000_000.0) * pricing.get("input_cost_per_million", 0.10)
        output_cost = (completion_tokens / 1_000_000.0) * pricing.get("output_cost_per_million", 0.30)
        return input_cost + output_cost


settings = Settings()
