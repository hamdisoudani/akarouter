# AKAROUTER Frontend

Next.js 14 + TypeScript + Supabase Auth frontend for AKAROUTER.

## Features

- **Landing Page** - Brand-aligned marketing page with feature highlights
- **Magic Link Auth** - Supabase Auth with email OTP (no passwords)
- **Dashboard** - Chat interface calling the Railway backend API
- **Model Selection** - Dynamic model list from `/v1/models` endpoint

## Local Development

```bash
cp .env.example .env.local
# Add your Supabase anon key
npm install
npm run dev
```

## Deploy to Vercel

1. Connect this repo folder to Vercel
2. Add environment variables:
   - `NEXT_PUBLIC_API_URL` = `https://akarouter-production.up.railway.app`
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://fleouqrgltkodumrgxlt.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (from Supabase Project Settings > API)
3. Deploy

## Supabase Auth Configuration

In Supabase Dashboard > Authentication > URL Configuration:
- **Site URL**: `https://your-vercel-domain.vercel.app`
- **Redirect URLs**: `https://your-vercel-domain.vercel.app/auth/callback`
