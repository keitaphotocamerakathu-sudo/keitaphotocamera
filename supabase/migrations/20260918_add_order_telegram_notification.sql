alter table public.orders
  add column if not exists telegram_notified_at timestamptz;
