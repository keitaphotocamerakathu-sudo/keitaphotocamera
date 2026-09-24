alter table public.photos
  add column if not exists free_download_path text,
  add column if not exists free_download_url text,
  add column if not exists free_download_watermark_version text,
  add column if not exists free_download_generated_at timestamptz;
