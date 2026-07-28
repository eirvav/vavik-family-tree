-- Phase 4b: editing via floating action bar.

-- 1. Surname at birth (fødselsnavn) — shown/edited in the personal info tab.
alter table people add column birth_family_name text;

-- 2. Admin-only helper, distinct from app_is_member_or_admin() (which only
-- checks for an active profile, not a specific role).
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
      and status = 'active'
      and role = 'admin'
  );
$$;

-- 3. Tighten people/relationships INSERT and UPDATE to admin-only. Editing
-- (Phase 4b) is an admin-only capability except for biography text, which
-- members reach through update_person_biography() below instead.
drop policy "people_insert_member_or_admin" on people;
create policy "people_insert_admin"
  on people for insert
  to authenticated
  with check (app_is_admin());

drop policy "people_update_member_or_admin" on people;
create policy "people_update_admin"
  on people for update
  to authenticated
  using (app_is_admin())
  with check (app_is_admin());

drop policy "relationships_insert_member_or_admin" on relationships;
create policy "relationships_insert_admin"
  on relationships for insert
  to authenticated
  with check (app_is_admin());

drop policy "relationships_update_member_or_admin" on relationships;
create policy "relationships_update_admin"
  on relationships for update
  to authenticated
  using (app_is_admin())
  with check (app_is_admin());

-- 4. Biography-only path for members: a security-definer RPC that checks
-- the caller itself (member or admin) rather than relying on the
-- now-admin-only table policy above, and only ever touches the biography
-- column (plus bookkeeping columns). Admins also use this RPC for
-- biography edits.
create or replace function update_person_biography(p_person_id uuid, p_biography text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not app_is_member_or_admin() then
    raise exception 'Not authorized';
  end if;

  update people
  set biography = p_biography,
      updated_at = now(),
      updated_by = auth.uid(),
      version = version + 1
  where id = p_person_id
    and deleted_at is null;

  if not found then
    raise exception 'Person not found';
  end if;
end;
$$;

grant execute on function update_person_biography(uuid, text) to authenticated;

-- 5. Atomic "create a person and link them to the tree" RPC. Takes a JSON
-- array of edges so the caller (a TypeScript server action) can decide how
-- many relationships to create — one for father/mother/partner/child, one
-- per existing parent for sibling — while the person and all of their
-- relationships are still inserted in a single transaction. p_edges shape:
-- [{ "other_person_id": uuid, "relationship_type": text, "new_person_is_a": boolean }]
-- new_person_is_a = true means the new person is person_a (the parent) in
-- that edge; false means the new person is person_b (the child/partner).
create or replace function create_related_person(
  p_given_name text,
  p_family_name text,
  p_gender gender,
  p_edges jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  edge jsonb;
begin
  if not app_is_admin() then
    raise exception 'Not authorized';
  end if;

  insert into people (given_name, family_name, gender, is_living, created_by, updated_by)
  values (p_given_name, p_family_name, p_gender, true, auth.uid(), auth.uid())
  returning id into new_id;

  for edge in select * from jsonb_array_elements(p_edges)
  loop
    if (edge->>'new_person_is_a')::boolean then
      insert into relationships (person_a_id, person_b_id, relationship_type, created_by, updated_by)
      values (new_id, (edge->>'other_person_id')::uuid, (edge->>'relationship_type')::relationship_type, auth.uid(), auth.uid());
    else
      insert into relationships (person_a_id, person_b_id, relationship_type, created_by, updated_by)
      values ((edge->>'other_person_id')::uuid, new_id, (edge->>'relationship_type')::relationship_type, auth.uid(), auth.uid());
    end if;
  end loop;

  return new_id;
end;
$$;

grant execute on function create_related_person(text, text, gender, jsonb) to authenticated;

-- 6. Atomic "soft-delete a person and all their active relationships" RPC.
-- The caller (a TypeScript server action) is responsible for running the
-- connectivity check BEFORE calling this — this function does not check
-- connectivity itself, it just performs the delete once the caller has
-- decided it's safe.
create or replace function delete_person(p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not app_is_admin() then
    raise exception 'Not authorized';
  end if;

  update relationships
  set deleted_at = now(), deleted_by = auth.uid()
  where (person_a_id = p_person_id or person_b_id = p_person_id)
    and deleted_at is null;

  update people
  set deleted_at = now(), deleted_by = auth.uid()
  where id = p_person_id
    and deleted_at is null;
end;
$$;

grant execute on function delete_person(uuid) to authenticated;
