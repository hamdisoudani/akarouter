# AKAROUTER

Multi-account AI inference proxy and routing layer.

## What this is
- Public-facing OpenAI-compatible API
- Accounts kept in Supabase with auto-refresh
- Round-robin + health-weighted routing

## Local run
```bash
cp .env.example .env
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Deploy
- Railway: use `railway.toml`
- Render: use `render.yaml`
- Docker: `docker build -t akarouter .`
