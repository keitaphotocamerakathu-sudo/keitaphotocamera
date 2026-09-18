create table if not exists public.stripe_webhook_config (
  id smallint primary key default 1 check (id = 1),
  endpoint_id text not null,
  endpoint_url text not null,
  signing_secret text not null,
  livemode boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.stripe_webhook_config enable row level security;

revoke all on table public.stripe_webhook_config from anon, authenticated;
grant all on table public.stripe_webhook_config to service_role;
