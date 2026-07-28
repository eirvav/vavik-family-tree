import { createClient } from "@/lib/supabase/server";

export type Person = {
  id: string;
  given_name: string;
  family_name: string;
  birth_family_name: string | null;
  gender: "male" | "female" | "unknown";
  is_living: boolean;
  birth_date_display: string | null;
  death_date_display: string | null;
  biography: string | null;
  birth_place: string | null;
  death_place: string | null;
};

export type Relationship = {
  id: string;
  person_a_id: string;
  person_b_id: string;
  relationship_type:
    | "biological_parent"
    | "adoptive_parent"
    | "foster_parent"
    | "guardian_parent"
    | "spouse"
    | "former_spouse"
    | "partner"
    | "former_partner";
};

export async function getFamilyTreeData() {
  const supabase = await createClient();

  const [peopleResult, relationshipsResult] = await Promise.all([
    supabase
      .from("people")
      .select(
        "id, given_name, family_name, birth_family_name, gender, is_living, birth_date_display, death_date_display, biography, birth_place, death_place"
      )
      .is("deleted_at", null),
    supabase
      .from("relationships")
      .select("id, person_a_id, person_b_id, relationship_type")
      .is("deleted_at", null),
  ]);

  if (peopleResult.error) throw new Error(peopleResult.error.message);
  if (relationshipsResult.error) throw new Error(relationshipsResult.error.message);

  return {
    people: (peopleResult.data ?? []) as Person[],
    relationships: (relationshipsResult.data ?? []) as Relationship[],
  };
}
