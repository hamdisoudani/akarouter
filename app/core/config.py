from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        env_prefix="AKAROUTER_"
    )

    app_env: str = "development"
    port: int = 8000

    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_db_url: str = ""

    nous_api_base: str = "https://inference-api.nousresearch.com/v1"
    nous_client_id: str = "hermes-cli"
    nous_scope: str = "inference:invoke"
    nous_device_code_url: str = "https://portal.nousresearch.com/api/oauth/device/code"
    nous_token_url: str = "https://portal.nousresearch.com/api/oauth/token"
    token_refresh_skew: int = 120
    refresh_lock_ttl: int = 30
    max_concurrent_per_account: int = 12
    akarouter_default_model: str = "stepfun/step-3.7-flash:free"
    akarouter_default_pro_model: str = "stepfun/step-3.7-flash:free"


settings = Settings()
