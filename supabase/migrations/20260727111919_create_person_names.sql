create type name_type as enum ('former', 'birth', 'nickname');

create table person_names (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  name_type name_type not null,
  value text not null,
  ordering int not null default 0,
  notes text,
  deleted_at timestamptz,
  deleted_by uuid references profiles(user_id)
);

alter table person_names enable row level security;

create policy "person_names_select_visible"
  on person_names for select
  to authenticated
  using (
    app_is_member_or_admin()
    or (app_is_authorized_guest() and deleted_at is null)
  );

create policy "person_names_insert_member_or_admin"
  on person_names for insert
  to authenticated
  with check (app_is_member_or_admin());

create policy "person_names_update_member_or_admin"
  on person_names for update
  to authenticated
  using (app_is_member_or_admin())
  with check (app_is_member_or_admin());

grant select, insert, update on person_names to authenticated;
