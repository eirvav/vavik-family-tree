-- supabase/tests/rls_phase1.sql
-- Manual RLS assertions for the foundation/secure-access phase.
-- Run the whole file in one execute_sql call. It wraps itself in a
-- transaction that always rolls back, so it never leaves test data behind.
-- Every failed assertion raises an exception, so "no output" means "passed".

begin;

-- Fixture: a fake admin, a fake member, a fake disabled member, and an
-- auth.users row for each so the FK on profiles is satisfied.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'member@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'disabled@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'guest-anon@example.test');

insert into profiles (user_id, display_name, role, status) values
  ('11111111-1111-1111-1111-111111111111', 'Test Admin', 'admin', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'Test Member', 'member', 'active'),
  ('33333333-3333-3333-3333-333333333333', 'Test Disabled', 'member', 'disabled');

insert into guest_sessions (user_id, expires_at) values
  ('44444444-4444-4444-4444-444444444444', now() + interval '1 day');

-- Assertion 1: unauthenticated (no jwt claims set) resolves to unauthorized.
set local role anon;
set local request.jwt.claims = '';
do $$
begin
  if app_is_authorized() then
    raise exception 'FAIL: unauthenticated resolved as authorized';
  end if;
end $$;

-- Assertion 2: anonymous identity WITHOUT a guest_sessions row is unauthorized.
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","is_anonymous":true}';
do $$
begin
  if app_is_authorized() then
    raise exception 'FAIL: anonymous without guest_sessions resolved as authorized';
  end if;
end $$;

-- Assertion 3: anonymous identity WITH a valid guest_sessions row is authorized.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","is_anonymous":true}';
do $$
begin
  if not app_is_authorized() then
    raise exception 'FAIL: authorized guest resolved as unauthorized';
  end if;
  if app_is_admin() then
    raise exception 'FAIL: guest resolved as admin';
  end if;
end $$;

-- Assertion 4: active member resolves as member_or_admin but not admin.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
do $$
begin
  if not app_is_member_or_admin() then
    raise exception 'FAIL: active member not resolved as member_or_admin';
  end if;
  if app_is_admin() then
    raise exception 'FAIL: member resolved as admin';
  end if;
  if not app_is_authorized() then
    raise exception 'FAIL: member not resolved as authorized';
  end if;
end $$;

-- Assertion 5: disabled member resolves as NOT authorized at all.
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
do $$
begin
  if app_is_member_or_admin() then
    raise exception 'FAIL: disabled member resolved as member_or_admin';
  end if;
  if app_is_authorized() then
    raise exception 'FAIL: disabled member resolved as authorized';
  end if;
end $$;

-- Assertion 6: active admin resolves as admin.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
do $$
begin
  if not app_is_admin() then
    raise exception 'FAIL: active admin not resolved as admin';
  end if;
end $$;

-- Assertion 7: a member cannot read guest_sessions (admin-only select policy).
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
do $$
declare
  visible_rows int;
begin
  select count(*) into visible_rows from guest_sessions;
  if visible_rows <> 0 then
    raise exception 'FAIL: member could see % guest_sessions row(s)', visible_rows;
  end if;
end $$;

-- Assertion 8: a member cannot change their own role via UPDATE.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
do $$
begin
  begin
    update profiles set role = 'admin' where user_id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FAIL: member successfully self-promoted to admin';
  exception
    when others then
      if sqlerrm not like '%only an administrator%' then
        raise;
      end if;
  end;
end $$;

rollback;
