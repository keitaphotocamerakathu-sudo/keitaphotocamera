create or replace function public.stop_preview_optimizer_job()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'optimize-image-previews-every-minute';
end;
$$;

revoke all on function public.stop_preview_optimizer_job()
  from public, anon, authenticated;
grant execute on function public.stop_preview_optimizer_job()
  to service_role;

do $$
declare
  old_job bigint;
begin
  select jobid into old_job
  from cron.job
  where jobname = 'optimize-image-previews-every-minute'
  limit 1;

  if old_job is not null then
    perform cron.unschedule(old_job);
  end if;
end
$$;

select cron.schedule(
  'optimize-image-previews-every-minute',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://yuvsusdnecrmbcsifgbk.supabase.co/functions/v1/optimize-image-previews',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-job-token', (
          select token
          from public.internal_job_secrets
          where job_name='optimize-image-previews'
        )
      ),
      body := jsonb_build_object('limit',10),
      timeout_milliseconds := 55000
    ) as request_id;
  $job$
);
