alter table public.photos
  add column if not exists face_scan_path text,
  add column if not exists face_scan_url text;

comment on column public.photos.face_scan_path is
  'Private/internal high-resolution image derivative used for face detection; customer UI should use preview instead.';
comment on column public.photos.face_scan_url is
  'Internal face-detection derivative URL. Not intended for customer storefront rendering.';
