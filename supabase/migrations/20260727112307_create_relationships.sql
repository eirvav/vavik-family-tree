create type relationship_type as enum (
  'biological_parent', 'adoptive_parent', 'foster_parent', 'guardian_parent',
  'spouse', 'former_spouse', 'partner', 'former_partner'
);

create table relationships (
  id uuid primary key default gen_random_uuid(),
  person_a_id uuid not null references people(id),
  person_b_id uuid not null references people(id),
  relationship_type relationship_type not null,
  start_date date,
  end_date date,
  notes text,
  version int not null default 1,
  deleted_at timestamptz,
  deleted_by uuid references profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(user_id),
  updated_by uuid references profiles(user_id),
  constraint relationships_no_self_reference check (person_a_id <> person_b_id)
);

create unique index relationships_no_duplicate_active_type
  on relationships (person_a_id, person_b_id, relationship_type)
  where deleted_at is null;

alter table relationships enable row level security;

create policy "relationships_select_visible"
  on relationships for select
  to authenticated
  using (
    app_is_member_or_admin()
    or (app_is_authorized_guest() and deleted_at is null)
  );

create policy "relationships_insert_member_or_admin"
  on relationships for insert
  to authenticated
  with check (app_is_member_or_admin());

create policy "relationships_update_member_or_admin"
  on relationships for update
  to authenticated
  using (app_is_member_or_admin())
  with check (app_is_member_or_admin());

grant select, insert, update on relationships to authenticated;

create or replace function relationships_prevent_ancestry_cycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cycle_found boolean;
begin
  if new.relationship_type not in ('biological_parent', 'adoptive_parent', 'foster_parent', 'guardian_parent') then
    return new;
  end if;

  with recursive ancestors as (
    select person_a_id as ancestor_id
    from relationships
    where person_b_id = new.person_a_id
      and relationship_type in ('biological_parent', 'adoptive_parent', 'foster_parent', 'guardian_parent')
      and deleted_at is null
    union
    select r.person_a_id
    from relationships r
    join ancestors a on r.person_b_id = a.ancestor_id
    where r.relationship_type in ('biological_parent', 'adoptive_parent', 'foster_parent', 'guardian_parent')
      and r.deleted_at is null
  )
  select exists (select 1 from ancestors where ancestor_id = new.person_b_id) into cycle_found;

  if cycle_found then
    raise exception 'This parent-child relationship would create an ancestry cycle';
  end if;

  return new;
end;
$$;

create trigger relationships_prevent_ancestry_cycle_trigger
  before insert or update on relationships
  for each row
  execute function relationships_prevent_ancestry_cycle();
