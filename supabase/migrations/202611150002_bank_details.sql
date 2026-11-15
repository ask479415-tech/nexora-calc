-- Per-user bank details for Nexora Calc bills.
-- Access is token-scoped for the calculator app; admin reads require an authenticated admin.
create table if not exists public.nexora_user_bank_details (
  user_id uuid primary key references public.nexora_users(id) on delete cascade,
  account_holder_name text not null default '',
  bank_name text not null default '',
  account_number text not null default '',
  ifsc text not null default '',
  branch text not null default '',
  upi_id text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.nexora_user_bank_details enable row level security;
revoke all on public.nexora_user_bank_details from anon, authenticated;

create or replace function public.nexora_get_bank_details(p_access_token uuid)
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'account_holder_name', coalesce(b.account_holder_name,''),
    'bank_name', coalesce(b.bank_name,''),
    'account_number', coalesce(b.account_number,''),
    'ifsc', coalesce(b.ifsc,''),
    'branch', coalesce(b.branch,''),
    'upi_id', coalesce(b.upi_id,'')
  )
  from public.nexora_users u
  left join public.nexora_user_bank_details b on b.user_id = u.id
  where u.access_token_hash = encode(digest(p_access_token::text,'sha256'),'hex')
    and u.status = 'approved'
  limit 1;
$$;

create or replace function public.nexora_save_bank_details(
  p_access_token uuid,
  p_account_holder_name text,
  p_bank_name text,
  p_account_number text,
  p_ifsc text,
  p_branch text,
  p_upi_id text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
  from public.nexora_users
  where access_token_hash = encode(digest(p_access_token::text,'sha256'),'hex')
    and status = 'approved'
  limit 1;

  if v_user_id is null then
    raise exception 'Approved account required.';
  end if;

  if length(trim(coalesce(p_account_holder_name,''))) > 120
     or length(trim(coalesce(p_bank_name,''))) > 120
     or length(trim(coalesce(p_account_number,''))) > 34
     or length(trim(coalesce(p_ifsc,''))) > 20
     or length(trim(coalesce(p_branch,''))) > 120
     or length(trim(coalesce(p_upi_id,''))) > 120 then
    raise exception 'Bank detail field is too long.';
  end if;

  insert into public.nexora_user_bank_details
    (user_id,account_holder_name,bank_name,account_number,ifsc,branch,upi_id,updated_at)
  values
    (v_user_id,trim(coalesce(p_account_holder_name,'')),trim(coalesce(p_bank_name,'')),
     trim(coalesce(p_account_number,'')),upper(trim(coalesce(p_ifsc,''))),
     trim(coalesce(p_branch,'')),trim(coalesce(p_upi_id,'')),now())
  on conflict (user_id) do update set
    account_holder_name=excluded.account_holder_name,
    bank_name=excluded.bank_name,
    account_number=excluded.account_number,
    ifsc=excluded.ifsc,
    branch=excluded.branch,
    upi_id=excluded.upi_id,
    updated_at=now();

  return public.nexora_get_bank_details(p_access_token);
end;
$$;

-- Never return the access-token hash or device identifier in the admin listing.
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
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',u.id,'name',u.name,'email',u.email,'mobile_number',u.mobile_number,
        'address',u.address,'company_name',u.company_name,'status',u.status,
        'created_at',u.created_at,'updated_at',u.updated_at
      ) order by u.created_at desc)
      from public.nexora_users u where u.status <> 'deleted'
    ),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.nexora_get_bank_details(uuid) from public;
revoke all on function public.nexora_save_bank_details(uuid,text,text,text,text,text,text) from public;
revoke all on function public.nexora_admin_list_users() from public;
grant execute on function public.nexora_get_bank_details(uuid) to anon, authenticated;
grant execute on function public.nexora_save_bank_details(uuid,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.nexora_admin_list_users() to authenticated;
