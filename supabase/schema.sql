-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Providers table: hermes, openrouter, groq, etc.
create table if not exists providers (
  id           uuid primary key default uuid_generate_v4(),
  name         text unique not null,
  type         text not null, -- 'hermes-nous', 'openrouter', 'groq'
  base_url     text,
  device_code_url text,
  token_url    text,
  config       jsonb default '{}', -- client_id, scopes, api_base, etc
  is_active    boolean default true,
  created_at   timestamptz default now()
);

-- Accounts table: one Hermes/OpenRouter/Groq account = one row
create table if not exists accounts (
  id              uuid primary key default uuid_generate_v4(),
  provider_id     uuid references providers(id),

  -- OAuth / token data
  connection_id   text unique, -- Composio connectionId or external id
  account_label   text, -- email or nickname for display
  access_token    text,
  refresh_token   text,
  expires_at      timestamptz, -- when this token is dead

  -- Supported models for this account (json array)
  models          jsonb default '[]',

  -- Health/routing
  weight          float default 1.0,
  is_active       boolean default true,
  health_status   text default 'unknown', -- healthy|degraded|rate_limited|dead
  last_error      text,
  last_used_at    timestamptz,
  total_requests  int default 0,
  total_errors    int default 0,

  -- Lock for refresh race prevention (pg advisory lock or timestamp)
  refresh_lock_at timestamptz,

  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_accounts_provider  on accounts(provider_id);
create index if not exists idx_accounts_active    on accounts(is_active, health_status);
create index if not exists idx_accounts_updated   on accounts(updated_at);

-- Request logs for monitoring and billing
create table if not exists request_logs (
  id              uuid primary key default uuid_generate_v4(),
  account_id      uuid references accounts(id),
  request_id      text, -- correlation id from client
  model           text,
  status          text, -- success|rate_limited|error|timeout
  http_status     int,
  latency_ms      int,
  error_message   text,
  tokens_used     int,
  created_at      timestamptz default now()
);

create index if not exists idx_request_logs_account on request_logs(account_id, created_at desc);
create index if not exists idx_request_logs_created on request_logs(created_at desc);

-- Helper: updated_at auto update
create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists accounts_touch on accounts;
create trigger accounts_touch
  before update on accounts
  for each row execute procedure touch_updated_at();

-- Seed provider row for Hermes/Nous
insert into providers (name, type, base_url, device_code_url, token_url, config)
values (
  'nous',
  'hermes-nous',
  'https://inference-api.nousresearch.com/v1',
  'https://portal.nousresearch.com/api/oauth/device/code',
  'https://portal.nousresearch.com/api/oauth/token',
  '{"client_id": "hermes-cli", "scope": "inference:invoke", "token_refresh_skew_seconds": 120}'
)
on conflict (name) do nothing;
