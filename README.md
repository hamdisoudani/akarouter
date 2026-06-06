# AKAROUTER

Multi-account AI inference proxy backed by Hermes/Nous with Supabase state and round-robin routing.

## Repo layout
- `server.py` — OpenAI-compatible proxy on `/v1/chat/completions`
- `generate_device_code.py` — manual Hermes account onboarding
- `nous_openai_proxy.py` — single-account development proxy
- `supabase/schema.sql` — production schema
- `.env.example` — local config template

## Security note
Secrets are managed via `.env` and Supabase service-role credentials. Do not commit real tokens.
