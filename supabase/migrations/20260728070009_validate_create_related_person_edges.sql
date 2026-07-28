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

  if exists (
    select 1 from jsonb_array_elements(p_edges) e
    where not exists (
      select 1 from people p
      where p.id = (e->>'other_person_id')::uuid and p.deleted_at is null
    )
  ) then
    raise exception 'Related person not found';
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
