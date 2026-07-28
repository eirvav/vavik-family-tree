-- Atomic "create both parents at once, already connected to each other
-- and to the selected child" RPC — replaces the old one-parent-at-a-time
-- flow, which had no way to link two independently-added parents to each
-- other. Mirrors create_related_person's transactional pattern: if
-- anything fails partway, nothing is left half-created.
create or replace function create_parent_pair(
  p_father_given_name text,
  p_father_family_name text,
  p_mother_given_name text,
  p_mother_family_name text,
  p_parent_relationship_type relationship_type,
  p_partner_relationship_type relationship_type,
  p_child_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  father_id uuid;
  mother_id uuid;
begin
  if not app_is_admin() then
    raise exception 'Not authorized';
  end if;

  if not exists (select 1 from people where id = p_child_id and deleted_at is null) then
    raise exception 'Child not found';
  end if;

  insert into people (given_name, family_name, gender, is_living, created_by, updated_by)
  values (p_father_given_name, p_father_family_name, 'male', true, auth.uid(), auth.uid())
  returning id into father_id;

  insert into people (given_name, family_name, gender, is_living, created_by, updated_by)
  values (p_mother_given_name, p_mother_family_name, 'female', true, auth.uid(), auth.uid())
  returning id into mother_id;

  insert into relationships (person_a_id, person_b_id, relationship_type, created_by, updated_by)
  values (father_id, mother_id, p_partner_relationship_type, auth.uid(), auth.uid());

  insert into relationships (person_a_id, person_b_id, relationship_type, created_by, updated_by)
  values (father_id, p_child_id, p_parent_relationship_type, auth.uid(), auth.uid());

  insert into relationships (person_a_id, person_b_id, relationship_type, created_by, updated_by)
  values (mother_id, p_child_id, p_parent_relationship_type, auth.uid(), auth.uid());
end;
$$;

grant execute on function create_parent_pair(text, text, text, text, relationship_type, relationship_type, uuid) to authenticated;
