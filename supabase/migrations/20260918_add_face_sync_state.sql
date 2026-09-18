alter table public.photos
  add column if not exists face_sync_version text,
  add column if not exists face_synced_at timestamptz,
  add column if not exists face_count integer;

comment on column public.photos.face_sync_version is
  'Version of the face-detection pipeline that last processed this media.';
comment on column public.photos.face_synced_at is
  'Timestamp when face detection last completed successfully for this media.';
comment on column public.photos.face_count is
  'Number of face descriptors found during the last successful face sync.';
