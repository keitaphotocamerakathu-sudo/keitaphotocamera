select cron.alter_job(
  job_id := (
    select jobid
    from cron.job
    where jobname='optimize-image-previews-every-minute'
    limit 1
  ),
  schedule := '* * * * *',
  command := $job$
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
      body := jsonb_build_object('limit',6),
      timeout_milliseconds := 55000
    ) as request_id;
  $job$
);
