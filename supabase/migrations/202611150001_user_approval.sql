create extension if not exists pgcrypto;

create table if not exists public.nexora_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  mobile_number text not null,
  address text not null,
  company_name text not null,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','deactivated','deleted')),
  device_id text not null unique,
  access_token_hash text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nexora_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.nexora_users enable row level security;
alter table public.nexora_admins enable row level security;
revoke all on public.nexora_users from anon, authenticated;
revoke all on public.nexora_admins from anon, authenticated;

create or replace function public.nexora_register_user(
  p_name text,
  p_email text,
  p_mobile_number text,
  p_address text,
  p_company_name text,
  p_device_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token uuid := gen_random_uuid();
  v_id uuid;
begin
  if length(trim(coalesce(p_name,''))) < 2
     or position('@' in coalesce(p_email,'')) < 2
     or length(regexp_replace(coalesce(p_mobile_number,''),'[^0-9]','','g')) < 10
     or length(trim(coalesce(p_address,''))) < 4
     or length(trim(coalesce(p_company_name,''))) < 2
     or length(trim(coalesce(p_device_id,''))) < 8 then
    raise exception 'Please provide all required registration details.';
  end if;

  insert into public.nexora_users
    (name,email,mobile_number,address,company_name,device_id,access_token_hash)
  values
    (trim(p_name),lower(trim(p_email)),trim(p_mobile_number),trim(p_address),
     trim(p_company_name),p_device_id,encode(digest(v_token::text,'sha256'),'hex'))
  returning id into v_id;

  return jsonb_build_object('access_token',v_token,'status','pending','user_id',v_id);
exception when unique_violation then
  raise exception 'This device is already registered. Please contact the administrator.';
end;
$$;

create or replace function public.nexora_check_access(p_access_token uuid)
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'status', u.status,
    'profile', jsonb_build_object(
      'name',u.name,'email',u.email,'mobile_number',u.mobile_number,
      'address',u.address,'company_name',u.company_name
    )
  )
  from public.nexora_users u
  where u.access_token_hash = encode(digest(p_access_token::text,'sha256'),'hex')
  limit 1;
$$;

create or replace function public.nexora_admin_list_users()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.nexora_admins a where a.user_id = auth.uid()) then
    raise exception 'Admin access required.';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.nexora_users where status <> 'deleted'),
    'users', coalesce((select jsonb_agg(to_jsonb(u) order by u.created_at desc)
      from public.nexora_users u where u.status <> 'deleted'),'[]'::jsonb)
  );
end;
$$;

create or replace function public.nexora_admin_set_status(p_user_id uuid,p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.nexora_admins a where a.user_id = auth.uid()) then
    raise exception 'Admin access required.';
  end if;
  if p_status not in ('approved','rejected','deactivated') then
    raise exception 'Unsupported user status.';
  end if;
  update public.nexora_users set status=p_status, updated_at=now() where id=p_user_id;
  if not found then raise exception 'User not found.'; end if;
end;
$$;

create or replace function public.nexora_admin_remove_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.nexora_admins a where a.user_id = auth.uid()) then
    raise exception 'Admin access required.';
  end if;
  update public.nexora_users set status='deleted', updated_at=now() where id=p_user_id;
  if not found then raise exception 'User not found.'; end if;
end;
$$;

revoke all on function public.nexora_register_user(text,text,text,text,text,text) from public;
revoke all on function public.nexora_check_access(uuid) from public;
revoke all on function public.nexora_admin_list_users() from public;
revoke all on function public.nexora_admin_set_status(uuid,text) from public;
revoke all on function public.nexora_admin_remove_user(uuid) from public;
grant execute on function public.nexora_register_user(text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.nexora_check_access(uuid) to anon, authenticated;
grant execute on function public.nexora_admin_list_users() to authenticated;
grant execute on function public.nexora_admin_set_status(uuid,text) to authenticated;
grant execute on function public.nexora_admin_remove_user(uuid) to authenticated;
