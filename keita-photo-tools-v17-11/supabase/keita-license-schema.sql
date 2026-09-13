-- KEITA PHOTO TOOLS v17.11 — one-time online activation (Supabase Free)
-- IMPORTANT: replace CHANGE_THIS_ADMIN_SECRET with a long random secret before running.

create extension if not exists pgcrypto;

create table if not exists public.keita_license_settings (
  id smallint primary key default 1 check (id = 1),
  admin_secret_hash text not null,
  updated_at timestamptz not null default now()
);

insert into public.keita_license_settings(id, admin_secret_hash)
values (1, encode(digest('CHANGE_THIS_ADMIN_SECRET','sha256'),'hex'))
on conflict (id) do nothing;

create table if not exists public.keita_licenses (
  license_id uuid primary key,
  key_hash text not null unique,
  key_hint text,
  customer_name text not null,
  photographer_code text,
  plan_type text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  target_device_hash text,
  activated_device_hash text,
  activated_at timestamptz,
  activation_count integer not null default 0,
  max_activations integer not null default 1,
  status text not null default 'issued' check (status in ('issued','activated','revoked')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.keita_license_settings enable row level security;
alter table public.keita_licenses enable row level security;

revoke all on public.keita_license_settings from anon, authenticated;
revoke all on public.keita_licenses from anon, authenticated;

create or replace function public.keita_license_admin_ok(p_admin_secret text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.keita_license_settings
    where id=1
      and admin_secret_hash = encode(digest(coalesce(p_admin_secret,''),'sha256'),'hex')
  );
$$;

revoke all on function public.keita_license_admin_ok(text) from public;

create or replace function public.keita_license_admin_issue(
  p_admin_secret text,
  p_license_id uuid,
  p_license_key text,
  p_customer_name text,
  p_photographer_code text,
  p_plan_type text,
  p_expires_at timestamptz,
  p_target_device_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_device_hash text;
begin
  if not public.keita_license_admin_ok(p_admin_secret) then
    raise exception 'ADMIN_SECRET_INVALID';
  end if;
  if p_license_key is null or length(p_license_key) < 20 then
    raise exception 'LICENSE_KEY_INVALID';
  end if;
  v_hash := encode(digest(p_license_key,'sha256'),'hex');
  v_device_hash := case when nullif(p_target_device_id,'') is null then null else encode(digest(p_target_device_id,'sha256'),'hex') end;

  insert into public.keita_licenses(
    license_id,key_hash,key_hint,customer_name,photographer_code,plan_type,
    expires_at,target_device_hash,max_activations,status,metadata
  ) values (
    p_license_id,v_hash,right(p_license_key,4),p_customer_name,nullif(p_photographer_code,''),
    p_plan_type,p_expires_at,v_device_hash,1,'issued',coalesce(p_metadata,'{}'::jsonb)
  );

  return jsonb_build_object('ok',true,'license_id',p_license_id,'status','issued');
exception when unique_violation then
  raise exception 'LICENSE_ALREADY_EXISTS';
end;
$$;

create or replace function public.keita_license_activate(
  p_license_id uuid,
  p_license_key text,
  p_device_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.keita_licenses%rowtype;
  v_key_hash text;
  v_device_hash text;
begin
  v_key_hash := encode(digest(coalesce(p_license_key,''),'sha256'),'hex');
  v_device_hash := encode(digest(coalesce(p_device_id,''),'sha256'),'hex');

  select * into r from public.keita_licenses
  where license_id = p_license_id
  for update;

  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','ไม่พบ License'); end if;
  if r.key_hash <> v_key_hash then return jsonb_build_object('ok',false,'code','KEY_INVALID','message','License Key ไม่ถูกต้อง'); end if;
  if r.status = 'revoked' then return jsonb_build_object('ok',false,'code','REVOKED','message','License ถูกยกเลิกแล้ว'); end if;
  if r.expires_at is not null and now() > r.expires_at then return jsonb_build_object('ok',false,'code','EXPIRED','message','License หมดอายุแล้ว'); end if;
  if r.target_device_hash is not null and r.target_device_hash <> v_device_hash then return jsonb_build_object('ok',false,'code','DEVICE_MISMATCH','message','License นี้ไม่ได้ออกให้เครื่องนี้'); end if;
  if r.activation_count >= r.max_activations or r.activated_at is not null then
    return jsonb_build_object('ok',false,'code','ALREADY_USED','message','License Key นี้ถูกเปิดใช้งานไปแล้วและใช้ซ้ำไม่ได้');
  end if;

  update public.keita_licenses
    set activated_at=now(), activated_device_hash=v_device_hash,
        activation_count=activation_count+1, status='activated', updated_at=now()
  where license_id=p_license_id;

  return jsonb_build_object(
    'ok',true,'code','ACTIVATED','license_id',r.license_id,
    'customer_name',r.customer_name,'photographer_code',r.photographer_code,
    'plan_type',r.plan_type,'expires_at',r.expires_at,'activated_at',now()
  );
end;
$$;

create or replace function public.keita_license_admin_reset(
  p_admin_secret text,
  p_license_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.keita_license_admin_ok(p_admin_secret) then raise exception 'ADMIN_SECRET_INVALID'; end if;
  update public.keita_licenses set activated_at=null,activated_device_hash=null,activation_count=0,status='issued',updated_at=now()
  where license_id=p_license_id;
  if not found then raise exception 'LICENSE_NOT_FOUND'; end if;
  return jsonb_build_object('ok',true,'license_id',p_license_id,'status','issued');
end;
$$;

create or replace function public.keita_license_admin_revoke(
  p_admin_secret text,
  p_license_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.keita_license_admin_ok(p_admin_secret) then raise exception 'ADMIN_SECRET_INVALID'; end if;
  update public.keita_licenses set status='revoked',updated_at=now() where license_id=p_license_id;
  if not found then raise exception 'LICENSE_NOT_FOUND'; end if;
  return jsonb_build_object('ok',true,'license_id',p_license_id,'status','revoked');
end;
$$;

create or replace function public.keita_license_admin_status(
  p_admin_secret text,
  p_license_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.keita_licenses%rowtype;
begin
  if not public.keita_license_admin_ok(p_admin_secret) then raise exception 'ADMIN_SECRET_INVALID'; end if;
  select * into r from public.keita_licenses where license_id=p_license_id;
  if not found then raise exception 'LICENSE_NOT_FOUND'; end if;
  return jsonb_build_object(
    'ok',true,'license_id',r.license_id,'customer_name',r.customer_name,
    'photographer_code',r.photographer_code,'plan_type',r.plan_type,
    'status',r.status,'issued_at',r.issued_at,'expires_at',r.expires_at,
    'activated_at',r.activated_at,'activation_count',r.activation_count,'key_hint',r.key_hint
  );
end;
$$;

grant execute on function public.keita_license_activate(uuid,text,text) to anon, authenticated;
grant execute on function public.keita_license_admin_issue(text,uuid,text,text,text,text,timestamptz,text,jsonb) to anon, authenticated;
grant execute on function public.keita_license_admin_reset(text,uuid) to anon, authenticated;
grant execute on function public.keita_license_admin_revoke(text,uuid) to anon, authenticated;
grant execute on function public.keita_license_admin_status(text,uuid) to anon, authenticated;
