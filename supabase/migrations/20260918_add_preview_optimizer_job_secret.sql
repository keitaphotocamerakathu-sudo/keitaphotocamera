insert into public.internal_job_secrets(job_name, token)
values (
  'optimize-image-previews',
  gen_random_uuid()::text || gen_random_uuid()::text
)
on conflict (job_name) do nothing;
