-- Fix: relationships_prevent_ancestry_cycle() self-collision on UPDATE.
--
-- The trigger is BEFORE INSERT OR UPDATE ... FOR EACH ROW. Its recursive CTE
-- queried `relationships` directly by person_a_id/person_b_id match, with no
-- exclusion of the row currently being updated (new.id). Because this is a
-- BEFORE trigger, the row being updated still exists in the table in its
-- pre-update (OLD) state when the CTE's SELECT runs.
--
-- Concrete failure: row X represents (A, B, biological_parent) with no other
-- edges touching A or B. Updating that same row to (B, A, biological_parent)
-- (reversing direction) would have the trigger compute "ancestors of
-- new.person_a_id (=B)". The base case matches row X itself (its OLD
-- person_b_id is still B), making A appear as an "ancestor" of B, and since
-- new.person_b_id = A, the trigger wrongly concludes a cycle and rejects a
-- valid single-edge update.
--
-- Fix: exclude the row being modified (new.id) from both the base case and
-- the recursive term of the CTE. This is safe for INSERT too, since new.id
-- is always already populated by the gen_random_uuid() column default before
-- the trigger fires, so `id <> new.id` correctly does nothing for a
-- genuinely new row (it can't match any existing row's id).

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
      and id <> new.id
    union
    select r.person_a_id
    from relationships r
    join ancestors a on r.person_b_id = a.ancestor_id
    where r.relationship_type in ('biological_parent', 'adoptive_parent', 'foster_parent', 'guardian_parent')
      and r.deleted_at is null
      and r.id <> new.id
  )
  select exists (select 1 from ancestors where ancestor_id = new.person_b_id) into cycle_found;

  if cycle_found then
    raise exception 'This parent-child relationship would create an ancestry cycle';
  end if;

  return new;
end;
$$;
