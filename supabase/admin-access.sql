-- Nexora Calc: complete profile schema + admin role support
-- Run this file in Supabase SQL Editor to align older user_profiles tables
-- with the current Android app and Admin customer-management function.

alter table public.user_profiles
  add column if not exists email text,
  add column if not exists status text not null default 'pending',
  add column if not exists role text not null default 'customer',
  add column if not exists full_name text,
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists company_name text,
  add column if not exists bank_holder_name text,
  add column if not exists bank_name text,
  add column if not exists account_number text,
  add column if not exists ifsc_code text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Keep existing role/status values; only fill missing values safely.
update public.user_profiles
set role = coalesce(role, 'customer'),
    status = coalesce(status, 'pending');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_profiles_role_check'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_role_check
      check (role in ('customer', 'admin'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_profiles_status_check'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_status_check
      check (status in ('pending', 'active', 'inactive'));
  end if;
end
$$;

-- Ensure the profile email matches the linked Supabase Auth account.
update public.user_profiles p
set email = u.email
from auth.users u
where p.user_id = u.id
  and (p.email is null or p.email <> u.email);

-- Promote only the owner's account if it is already registered.
-- This query is intentionally commented out. Run separately only if needed:
-- update public.user_profiles
-- set role = 'admin', status = 'active', updated_at = now()
-- where email = 'alimsk7861@outlook.com';

-- Refresh the Supabase REST schema cache after adding the columns.
notify pgrst, 'reload schema';
