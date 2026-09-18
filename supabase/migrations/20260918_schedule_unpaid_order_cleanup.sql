create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare
  existing_job bigint;
begin
  select jobid
    into existing_job
  from cron.job
  where jobname = 'cleanup-unpaid-orders-every-5-min'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end
$$;

select cron.schedule(
  'cleanup-unpaid-orders-every-5-min',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := 'https://yuvsusdnecrmbcsifgbk.supabase.co/functions/v1/cleanup-unpaid-orders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    ) as request_id;
  $cron$
);
