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
