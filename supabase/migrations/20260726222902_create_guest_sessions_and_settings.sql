-- supabase/migrations/20260726222902_create_guest_sessions_and_settings.sql

create table guest_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  issued_by uuid references profiles(user_id)
);

alter table guest_sessions enable row level security;

create policy "guest_sessions_admin_select"
  on guest_sessions for select
  to authenticated
  using (app_is_admin());

-- No insert/update/delete policy for any client role: only the
-- SECURITY DEFINER create_guest_session() function (Task 6) writes here.

create table app_settings (
  id smallint primary key default 1,
  guest_code_hash text,
  guest_session_lifetime_days int not null default 7,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(user_id),
  constraint app_settings_singleton check (id = 1)
);

insert into app_settings (id) values (1);

alter table app_settings enable row level security;

create policy "app_settings_admin_all"
  on app_settings for all
  to authenticated
  using (app_is_admin())
  with check (app_is_admin());

create or replace function app_is_authorized_guest()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and exists (
      select 1 from guest_sessions
      where user_id = auth.uid()
        and revoked_at is null
        and expires_at > now()
    );
$$;

create or replace function app_is_authorized()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select app_is_member_or_admin() or app_is_authorized_guest();
$$;
