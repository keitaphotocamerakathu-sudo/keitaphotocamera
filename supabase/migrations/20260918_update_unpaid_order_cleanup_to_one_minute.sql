select cron.alter_job(
  job_id := (
    select jobid
    from cron.job
    where jobname = 'cleanup-unpaid-orders-every-5-min'
    limit 1
  ),
  schedule := '* * * * *'
);
