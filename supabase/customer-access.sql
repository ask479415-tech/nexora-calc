-- Nexora Calc customer account access control
-- Run once in Supabase SQL Editor. New sign-ups are active by default.
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_nexora_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (user_id, email, status)
  values (new.id, new.email, 'active')
  on conflict (user_id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_nexora on auth.users;
create trigger on_auth_user_created_nexora
after insert on auth.users
for each row execute procedure public.handle_new_nexora_user();

-- Backfill accounts that existed before this trigger was installed.
insert into public.user_profiles (user_id, email, status)
select id, email, 'active' from auth.users
on conflict (user_id) do update set email = excluded.email;

alter table public.user_profiles enable row level security;
grant select on public.user_profiles to authenticated;
drop policy if exists "Users can read own access status" on public.user_profiles;
create policy "Users can read own access status"
on public.user_profiles for select to authenticated
using (auth.uid() = user_id);

-- Intentionally no client INSERT/UPDATE/DELETE policy:
-- customers cannot activate themselves or change another user's status.
-- Admin action in Supabase SQL Editor:
-- update public.user_profiles set status = 'inactive', updated_at = now()
-- where user_id = (select id from auth.users where email = 'customer@example.com');
-- Reactivate:
-- update public.user_profiles set status = 'active', updated_at = now()
-- where user_id = (select id from auth.users where email = 'customer@example.com');
