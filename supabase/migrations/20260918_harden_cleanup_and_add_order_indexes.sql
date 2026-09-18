create index if not exists orders_event_id_idx
  on public.orders(event_id);

create index if not exists order_items_event_id_idx
  on public.order_items(event_id);

create index if not exists order_items_photo_id_idx
  on public.order_items(photo_id);

create index if not exists orders_pending_stripe_cleanup_idx
  on public.orders(payment_provider, status, created_at)
  where paid_at is null;

create table if not exists public.internal_job_secrets (
  job_name text primary key,
  token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.internal_job_secrets enable row level security;
revoke all on table public.internal_job_secrets from anon, authenticated;
grant all on table public.internal_job_secrets to service_role;

insert into public.internal_job_secrets(job_name, token)
values (
  'cleanup-unpaid-orders',
  gen_random_uuid()::text || gen_random_uuid()::text
)
on conflict (job_name) do nothing;

select cron.alter_job(
  job_id := (
    select jobid
    from cron.job
    where jobname = 'cleanup-unpaid-orders-every-5-min'
    limit 1
  ),
  schedule := '* * * * *',
  command := $job$
    select net.http_post(
      url := 'https://yuvsusdnecrmbcsifgbk.supabase.co/functions/v1/cleanup-unpaid-orders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-token', (
          select token
          from public.internal_job_secrets
          where job_name = 'cleanup-unpaid-orders'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    ) as request_id;
  $job$
);
