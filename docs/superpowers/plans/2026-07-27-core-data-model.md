# Core Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `people`, `person_names`, and `relationships` tables with RLS, validation, and search infrastructure — the data layer Phase 3 (tree canvas) and Phase 4 (edit forms) will build on. No UI in this phase.

**Architecture:** Pure database layer, same as Phase 0/1's migration tasks. Every RLS policy routes through the existing `app_is_authorized()` / `app_is_member_or_admin()` / `app_is_authorized_guest()` helper functions. Soft-deleted rows stay visible to members/admins (future recovery UI) but are hidden from guests via the SELECT policy itself, not by trusting application code to filter.

**Tech Stack:** Supabase Postgres, applied via `mcp__supabase__apply_migration`, tested via `mcp__supabase__execute_sql`.

## Global Constraints

- No UI, no forms, no audit triggers, no stories/avatars — those are later phases. This phase is exercised entirely through SQL tests.
- Migrations applied directly to the remote Supabase project (ref `aepiajqwquxwcgvxqmrl`), identical SQL committed to `supabase/migrations/`. Get the actual registered version from `mcp__supabase__list_migrations` before naming the local file — this project has hit a filename/version mismatch multiple times; always confirm before naming.
- Base-table GRANTs to `authenticated` must accompany every RLS policy explicitly — RLS alone does not grant Postgres table privileges in this project (confirmed the hard way twice already: Tasks 8 and the password-auth pivot both needed a corrective grants migration after the fact). Do not skip granting `select, insert, update` on each new table to `authenticated`.
- All content is guest-visible in this release (no member-only field visibility) — except that soft-deleted rows are hidden from guests specifically (not a contradiction: this is about deletion state, not field sensitivity).
- No hard-delete capability anywhere — no DELETE RLS policy on any of the three tables.
- Design doc for this phase: `docs/superpowers/specs/2026-07-27-core-data-model-design.md`. If anything here conflicts with that doc, the doc wins and the plan should be corrected.

---

## File Structure

```
supabase/migrations/
  <ts>_create_people.sql
  <ts>_create_person_names.sql
  <ts>_create_relationships.sql
  <ts>_enable_trigram_search.sql
supabase/tests/
  core_data_model.sql
```

---

### Task 1: `people` table

**Files:**
- Create: `supabase/migrations/<timestamp>_create_people.sql`

**Interfaces:**
- Consumes: `app_is_member_or_admin()`, `app_is_authorized_guest()` (existing functions from Phase 0/1).
- Produces: `date_precision` enum, `people` table. Task 2 and 3 reference `people(id)` via foreign key.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/<timestamp>_create_people.sql

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
```

- [ ] **Step 2: Apply it**

Call `mcp__supabase__apply_migration` with `name: "create_people"` and the query above. Then call `mcp__supabase__list_migrations` and name the local file using the exact returned version.

- [ ] **Step 3: Verify**

Via `mcp__supabase__execute_sql`:

```sql
select column_name, is_nullable, data_type from information_schema.columns where table_name = 'people' order by ordinal_position;
select grantee, privilege_type from information_schema.role_table_grants where table_name = 'people' and grantee = 'authenticated';
```

Expected: all columns from the migration present with correct nullability; `authenticated` has SELECT/INSERT/UPDATE (not DELETE).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "Add people table with RLS"
```

---

### Task 2: `person_names` table

**Files:**
- Create: `supabase/migrations/<timestamp>_create_person_names.sql`

**Interfaces:**
- Consumes: `people(id)` (Task 1).
- Produces: `name_type` enum, `person_names` table.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/<timestamp>_create_person_names.sql

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
```

- [ ] **Step 2: Apply it**

Same pattern: `apply_migration` with `name: "create_person_names"`, then confirm registered version via `list_migrations` before naming the local file.

- [ ] **Step 3: Verify**

```sql
select column_name from information_schema.columns where table_name = 'person_names';
select grantee, privilege_type from information_schema.role_table_grants where table_name = 'person_names' and grantee = 'authenticated';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "Add person_names table with RLS"
```

---

### Task 3: `relationships` table with validation

**Files:**
- Create: `supabase/migrations/<timestamp>_create_relationships.sql`

**Interfaces:**
- Consumes: `people(id)` (Task 1).
- Produces: `relationship_type` enum, `relationships` table, `relationships_prevent_ancestry_cycle()` trigger function + trigger.

This is the most important task to get exactly right — the ancestry-cycle trigger is the one piece of genuinely non-trivial logic in this phase.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/<timestamp>_create_relationships.sql

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
```

Notes for the implementer:
- The self-reference check is a plain `check` constraint (Postgres enforces it directly, no trigger needed) — do not duplicate that logic in the trigger.
- The recursive CTE's base case (`select person_a_id from relationships where person_b_id = new.person_a_id ...`) already covers the direct 2-node cycle case (proposed child is already a direct parent of the proposed parent), since that's exactly what the base case selects. Don't add a separate direct-cycle check — it would be redundant.

- [ ] **Step 2: Apply it**

`apply_migration` with `name: "create_relationships"`, then confirm registered version and name the local file accordingly.

- [ ] **Step 3: Verify**

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'relationships'::regclass;
select indexname, indexdef from pg_indexes where tablename = 'relationships';
select tgname from pg_trigger where tgrelid = 'relationships'::regclass;
```

Expected: the self-reference check constraint, the partial unique index, and the ancestry-cycle trigger all present.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "Add relationships table with ancestry-cycle and duplicate validation"
```

---

### Task 4: Trigram search indexes

**Files:**
- Create: `supabase/migrations/<timestamp>_enable_trigram_search.sql`

**Interfaces:**
- Consumes: `people`, `person_names` (Tasks 1-2).
- Produces: `pg_trgm` extension enabled, GIN trigram indexes. Nothing in this phase queries them yet — they exist for Phase 3's search UI to use.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/<timestamp>_enable_trigram_search.sql

create extension if not exists pg_trgm;

create index people_given_name_trgm on people using gin (given_name gin_trgm_ops);
create index people_family_name_trgm on people using gin (family_name gin_trgm_ops);
create index people_birth_place_trgm on people using gin (birth_place gin_trgm_ops);
create index people_death_place_trgm on people using gin (death_place gin_trgm_ops);
create index person_names_value_trgm on person_names using gin (value gin_trgm_ops);
```

- [ ] **Step 2: Apply it**

`apply_migration` with `name: "enable_trigram_search"`, then confirm registered version and name the local file accordingly.

- [ ] **Step 3: Verify**

```sql
select extname from pg_extension where extname = 'pg_trgm';
select indexname from pg_indexes where tablename in ('people', 'person_names') and indexname like '%trgm%';
```

Expected: extension present, all 5 indexes present.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "Enable pg_trgm and add trigram search indexes"
```

---

### Task 5: SQL test coverage

**Files:**
- Create: `supabase/tests/core_data_model.sql`

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: a repeatable manual test script, following the exact pattern of `supabase/tests/rls_phase1.sql` (wrapped in `begin`/`rollback`, role-switching via `set local role` + `set local request.jwt.claims`).

- [ ] **Step 1: Write the test script**

```sql
-- supabase/tests/core_data_model.sql
-- Manual assertions for the core data model (people/person_names/relationships).
-- Run the whole file in one execute_sql call. It wraps itself in a
-- transaction that always rolls back, so it never leaves test data behind.
-- Every failed assertion raises an exception, so "no output" means "passed".

begin;

-- Fixture: reuse the same test identities pattern as rls_phase1.sql.
insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'admin2@example.test'),
  ('a2222222-2222-2222-2222-222222222222', 'member2@example.test'),
  ('a4444444-4444-4444-4444-444444444444', 'guest2-anon@example.test');

insert into profiles (user_id, email, first_name, last_name, role, status) values
  ('a1111111-1111-1111-1111-111111111111', 'admin2@example.test', 'Test', 'Admin2', 'admin', 'active'),
  ('a2222222-2222-2222-2222-222222222222', 'member2@example.test', 'Test', 'Member2', 'member', 'active');

insert into guest_sessions (user_id, expires_at) values
  ('a4444444-4444-4444-4444-444444444444', now() + interval '1 day');

-- As admin, create three people and a parent-child relationship for the
-- cycle test, all via the DO block below so RLS is exercised the same way
-- a real member/admin request would hit it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-1111-1111-111111111111"}';

do $$
declare
  grandparent_id uuid := 'b1111111-1111-1111-1111-111111111111';
  parent_id uuid := 'b2222222-2222-2222-2222-222222222222';
  child_id uuid := 'b3333333-3333-3333-3333-333333333333';
begin
  insert into people (id, given_name, family_name, is_living) values
    (grandparent_id, 'Grandparent', 'Testsen', false),
    (parent_id, 'Parent', 'Testsen', false),
    (child_id, 'Child', 'Testsen', true);

  insert into relationships (person_a_id, person_b_id, relationship_type) values
    (grandparent_id, parent_id, 'biological_parent'),
    (parent_id, child_id, 'biological_parent');
end $$;

-- Assertion 1: member can insert a person and a relationship (RLS allows it).
set local request.jwt.claims = '{"sub":"a2222222-2222-2222-2222-222222222222"}';
do $$
declare
  new_person_id uuid := 'c1111111-1111-1111-1111-111111111111';
begin
  insert into people (id, given_name, family_name, is_living) values (new_person_id, 'Member', 'Created', true);
  insert into person_names (person_id, name_type, value) values (new_person_id, 'nickname', 'Testy');
exception
  when others then
    raise exception 'FAIL: member could not insert person/name: %', sqlerrm;
end $$;

-- Assertion 2: guest cannot insert a person.
set local request.jwt.claims = '{"sub":"a4444444-4444-4444-4444-444444444444","is_anonymous":true}';
do $$
begin
  begin
    insert into people (given_name, family_name, is_living) values ('Guest', 'Attempt', true);
    raise exception 'FAIL: guest successfully inserted a person';
  exception
    when insufficient_privilege then
      null; -- expected
    when others then
      -- RLS with-check violation also lands here depending on Postgres version's error class
      if sqlerrm not like '%row-level security%' then
        raise;
      end if;
  end;
end $$;

-- Assertion 3: guest can read people (visible, non-deleted).
do $$
declare
  visible_count int;
begin
  select count(*) into visible_count from people where family_name = 'Testsen';
  if visible_count <> 3 then
    raise exception 'FAIL: guest saw % Testsen rows, expected 3', visible_count;
  end if;
end $$;

-- Assertion 4: self-relationship is rejected by the check constraint.
set local request.jwt.claims = '{"sub":"a1111111-1111-1111-1111-111111111111"}';
do $$
begin
  begin
    insert into relationships (person_a_id, person_b_id, relationship_type)
    values ('b1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 'spouse');
    raise exception 'FAIL: self-relationship was accepted';
  exception
    when check_violation then
      null; -- expected
  end;
end $$;

-- Assertion 5: an ancestry cycle is rejected by the trigger.
do $$
begin
  begin
    -- child_id already a descendant of grandparent_id; making grandparent_id
    -- a child of child_id would create a cycle.
    insert into relationships (person_a_id, person_b_id, relationship_type)
    values ('b3333333-3333-3333-3333-333333333333', 'b1111111-1111-1111-1111-111111111111', 'biological_parent');
    raise exception 'FAIL: ancestry cycle was accepted';
  exception
    when others then
      if sqlerrm not like '%ancestry cycle%' then
        raise;
      end if;
  end;
end $$;

-- Assertion 6: a duplicate active relationship of the same type is rejected.
do $$
begin
  begin
    insert into relationships (person_a_id, person_b_id, relationship_type)
    values ('b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', 'biological_parent');
    raise exception 'FAIL: duplicate active relationship was accepted';
  exception
    when unique_violation then
      null; -- expected
  end;
end $$;

-- Assertion 7: soft-deleting a person succeeds and is hidden from guests
-- but still visible to admin.
do $$
begin
  update people set deleted_at = now(), deleted_by = 'a1111111-1111-1111-1111-111111111111'
  where id = 'b3333333-3333-3333-3333-333333333333';
end $$;

set local request.jwt.claims = '{"sub":"a4444444-4444-4444-4444-444444444444","is_anonymous":true}';
do $$
declare
  guest_sees_deleted boolean;
begin
  select exists (select 1 from people where id = 'b3333333-3333-3333-3333-333333333333') into guest_sees_deleted;
  if guest_sees_deleted then
    raise exception 'FAIL: guest could see a soft-deleted person';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"a1111111-1111-1111-1111-111111111111"}';
do $$
declare
  admin_sees_deleted boolean;
begin
  select exists (select 1 from people where id = 'b3333333-3333-3333-3333-333333333333') into admin_sees_deleted;
  if not admin_sees_deleted then
    raise exception 'FAIL: admin could not see a soft-deleted person';
  end if;
end $$;

-- Assertion 8: trigram indexes exist and pg_trgm is enabled.
reset role;
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    raise exception 'FAIL: pg_trgm extension not installed';
  end if;
  if not exists (select 1 from pg_indexes where tablename = 'people' and indexname = 'people_family_name_trgm') then
    raise exception 'FAIL: people_family_name_trgm index missing';
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run it**

Pass the file contents to `mcp__supabase__execute_sql`. Expected: no `FAIL:` exception raised. If any assertion fails, fix the migration in the relevant earlier task (never weaken the test), re-apply via a **new** migration, and re-run this script.

- [ ] **Step 3: Verify no residue**

```sql
select (select count(*) from auth.users where email like '%example.test%') as test_users,
       (select count(*) from people where family_name in ('Testsen', 'Created')) as test_people;
```

Expected: both 0 (the transaction rolled back).

- [ ] **Step 4: Commit**

```bash
git add supabase/tests
git commit -m "Add SQL test coverage for core data model"
```

---

## Self-Review Notes

- **Spec coverage:** every requirement from the design doc (§3 schema, §4 validation, §5 RLS, §6 search, §8 acceptance criteria) maps to a task: Task 1 (people), Task 2 (person_names), Task 3 (relationships + validation), Task 4 (search), Task 5 (test coverage exercising every acceptance criterion).
- **Placeholder scan:** no TBD/TODO; all SQL is complete and literal.
- **Type consistency:** `date_precision`, `name_type`, `relationship_type` enum values match exactly between the design doc and this plan's SQL. Foreign keys (`person_id`, `person_a_id`, `person_b_id`) all reference `people(id)`, matching Task 1's primary key type (uuid).
