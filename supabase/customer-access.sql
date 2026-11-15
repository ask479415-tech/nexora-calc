-- Nexora Calc customer registration and approval control. Run in Supabase SQL Editor.
create table if not exists public.user_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade, email text,
 status text not null default 'pending', role text not null default 'customer',
 full_name text, phone text, address text, company_name text, bank_holder_name text, bank_name text, account_number text, ifsc_code text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint user_profiles_status_check check(status in ('pending','active','inactive')),
 constraint user_profiles_role_check check(role in ('customer','admin'))
);
alter table public.user_profiles add column if not exists role text not null default 'customer';
alter table public.user_profiles add column if not exists full_name text;
alter table public.user_profiles add column if not exists phone text;
alter table public.user_profiles add column if not exists address text;
alter table public.user_profiles add column if not exists company_name text;
alter table public.user_profiles add column if not exists bank_holder_name text;
alter table public.user_profiles add column if not exists bank_name text;
alter table public.user_profiles add column if not exists account_number text;
alter table public.user_profiles add column if not exists ifsc_code text;
alter table public.user_profiles drop constraint if exists user_profiles_status_check;
alter table public.user_profiles add constraint user_profiles_status_check check(status in ('pending','active','inactive'));
create or replace function public.handle_new_nexora_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.user_profiles(user_id,email,status,full_name,phone,address,company_name,bank_holder_name,bank_name,account_number,ifsc_code)
 values(new.id,new.email,'pending',new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'phone',new.raw_user_meta_data->>'address',new.raw_user_meta_data->>'company_name',new.raw_user_meta_data->>'bank_holder_name',new.raw_user_meta_data->>'bank_name',new.raw_user_meta_data->>'account_number',new.raw_user_meta_data->>'ifsc_code')
 on conflict(user_id) do update set email=excluded.email;
 return new;
end; $$;
drop trigger if exists on_auth_user_created_nexora on auth.users;
create trigger on_auth_user_created_nexora after insert on auth.users for each row execute procedure public.handle_new_nexora_user();
insert into public.user_profiles(user_id,email,status) select id,email,'pending' from auth.users on conflict(user_id) do update set email=excluded.email;
alter table public.user_profiles enable row level security;
grant select on public.user_profiles to authenticated;
revoke update on public.user_profiles from authenticated;
grant update (full_name,phone,address,company_name,bank_holder_name,bank_name,account_number,ifsc_code,updated_at) on public.user_profiles to authenticated;
drop policy if exists "Users can read own access status" on public.user_profiles;
drop policy if exists "Users can read own profile" on public.user_profiles;
drop policy if exists "Users can update own profile details" on public.user_profiles;
create policy "Users can read own profile" on public.user_profiles for select to authenticated using(auth.uid()=user_id);
create policy "Users can update own profile details" on public.user_profiles for update to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
-- Promote owner after registration: update public.user_profiles set role='admin',status='active',updated_at=now() where email='YOUR_ADMIN_EMAIL';
