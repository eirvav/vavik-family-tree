create type gender as enum ('male', 'female', 'unknown');

alter table people add column gender gender not null default 'unknown';

create table canvas_positions (
  person_id uuid primary key references people(id) on delete cascade,
  x double precision not null,
  y double precision not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(user_id)
);

alter table canvas_positions enable row level security;

create policy "canvas_positions_select_authorized"
  on canvas_positions for select
  to authenticated
  using (app_is_authorized());

create policy "canvas_positions_insert_member_or_admin"
  on canvas_positions for insert
  to authenticated
  with check (app_is_member_or_admin());

create policy "canvas_positions_update_member_or_admin"
  on canvas_positions for update
  to authenticated
  using (app_is_member_or_admin())
  with check (app_is_member_or_admin());

grant select, insert, update on canvas_positions to authenticated;
