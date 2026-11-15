-- Nexora Calc: admin role support
-- Run this once in the Supabase SQL Editor after customer-access.sql.

alter table public.user_profiles
  add column if not exists role text not null default 'customer';

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
end
$$;

-- Existing and future accounts remain customers unless the owner promotes one.
update public.user_profiles
set role = 'customer'
where role is null;

-- Promote the owner's account only after that account has registered in the app.
-- Replace the email below with the owner's exact Supabase Auth email, then run separately:
-- update public.user_profiles
-- set role = 'admin', status = 'active', updated_at = now()
-- where email = 'YOUR_ADMIN_EMAIL';
