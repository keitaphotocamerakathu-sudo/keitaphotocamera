alter table public.events
  add column if not exists download_mode text not null default 'paid';

update public.events
set download_mode = 'paid'
where download_mode is null
   or download_mode not in ('paid', 'free');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'events_download_mode_check'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_download_mode_check
      check (download_mode in ('paid', 'free'));
  end if;
end $$;
