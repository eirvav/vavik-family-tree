-- supabase/migrations/20260726222151_create_profiles.sql

create type app_role as enum ('member', 'admin');

create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role app_role not null default 'member',
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create or replace function app_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid()
      and role = 'admin'
      and status = 'active'
  );
$$;

create or replace function app_is_member_or_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function profiles_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_is_admin() then
    return new;
  end if;

  if new.user_id <> old.user_id then
    raise exception 'cannot reassign profile ownership';
  end if;

  if new.role <> old.role or new.status <> old.status then
    raise exception 'only an administrator may change role or status';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_update_trigger
  before update on profiles
  for each row
  execute function profiles_guard_update();

create policy "profiles_select_own_or_admin"
  on profiles for select
  to authenticated
  using (user_id = auth.uid() or app_is_admin());

create policy "profiles_update_own_or_admin"
  on profiles for update
  to authenticated
  using (user_id = auth.uid() or app_is_admin())
  with check (user_id = auth.uid() or app_is_admin());

create policy "profiles_admin_insert"
  on profiles for insert
  to authenticated
  with check (app_is_admin());
