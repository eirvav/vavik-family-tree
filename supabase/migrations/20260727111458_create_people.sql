create type date_precision as enum ('exact', 'month_year', 'year_only', 'approximate', 'range', 'unknown');

create table people (
  id uuid primary key default gen_random_uuid(),
  given_name text not null,
  family_name text not null,
  biography text,
  is_living boolean not null,
  birth_date_precision date_precision,
  birth_date_value date,
  birth_date_range_end date,
  birth_date_display text,
  birth_place text,
  death_date_precision date_precision,
  death_date_value date,
  death_date_range_end date,
  death_date_display text,
  death_place text,
  version int not null default 1,
  deleted_at timestamptz,
  deleted_by uuid references profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(user_id),
  updated_by uuid references profiles(user_id)
);

alter table people enable row level security;

create policy "people_select_visible"
  on people for select
  to authenticated
  using (
    app_is_member_or_admin()
    or (app_is_authorized_guest() and deleted_at is null)
  );

create policy "people_insert_member_or_admin"
  on people for insert
  to authenticated
  with check (app_is_member_or_admin());

create policy "people_update_member_or_admin"
  on people for update
  to authenticated
  using (app_is_member_or_admin())
  with check (app_is_member_or_admin());

grant select, insert, update on people to authenticated;
