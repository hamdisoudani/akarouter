"""AKAROUTER Backend Configuration."""
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

    # Model mapping: alias -> upstream
    model_mapping: dict[str, str] = {
        "akarouter-pro": "stepfun/step-3.7-flash:free",
        "akarouter-flash": "nvidia/nemotron-3-ultra:free",
    }

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    def resolve_model(self, model_alias: str) -> str:
        """Map AkaRouter model names to upstream model IDs."""
        return self.model_mapping.get(model_alias, model_alias)


settings = Settings()
