"use server";

import { createClient } from "@/lib/supabase/server";
import type { Relationship } from "@/lib/family-tree/data";

const PARENT_RELATIONSHIP_TYPES = new Set<Relationship["relationship_type"]>([
  "biological_parent",
  "adoptive_parent",
  "foster_parent",
  "guardian_parent",
]);

type RelationKind = "father" | "mother" | "sibling" | "partner" | "child";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Ikke logget inn." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") {
    return { ok: false as const, error: "Kun administratorer kan gjøre dette." };
  }

  return { ok: true as const, supabase };
}

export async function createRelatedPerson(input: {
  selectedPersonId: string;
  kind: RelationKind;
  givenName: string;
  familyName: string;
  gender: "male" | "female" | "unknown";
  relationshipType: string;
}): Promise<{ ok: true; newPersonId: string } | { ok: false; error: string }> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;
  const { supabase } = authCheck;

  const givenName = input.givenName.trim();
  const familyName = input.familyName.trim();
  if (!givenName || !familyName) {
    return { ok: false, error: "Fornavn og etternavn må fylles ut." };
  }

  type Edge = { other_person_id: string; relationship_type: string; new_person_is_a: boolean };
  let edges: Edge[];

  if (input.kind === "father" || input.kind === "mother") {
    // New person is the parent (person_a); the selected person is the child (person_b).
    edges = [{ other_person_id: input.selectedPersonId, relationship_type: input.relationshipType, new_person_is_a: true }];
  } else if (input.kind === "child") {
    // Selected person is the parent (person_a); the new person is the child (person_b).
    edges = [{ other_person_id: input.selectedPersonId, relationship_type: input.relationshipType, new_person_is_a: false }];
  } else if (input.kind === "partner") {
    edges = [{ other_person_id: input.selectedPersonId, relationship_type: input.relationshipType, new_person_is_a: false }];
  } else {
    // sibling: link the new person as a child of each of the selected
    // person's existing active parents, mirroring that parent link's type.
    const { data: parentLinks, error: parentError } = await supabase
      .from("relationships")
      .select("person_a_id, relationship_type")
      .eq("person_b_id", input.selectedPersonId)
      .in("relationship_type", [...PARENT_RELATIONSHIP_TYPES])
      .is("deleted_at", null);

    if (parentError) {
      return { ok: false, error: "Kunne ikke hente foreldre." };
    }
    if (!parentLinks || parentLinks.length === 0) {
      return { ok: false, error: "Personen har ingen registrerte foreldre å knytte søsken til." };
    }

    edges = parentLinks.map((link) => ({
      other_person_id: link.person_a_id,
      relationship_type: link.relationship_type,
      new_person_is_a: false,
    }));
  }

  const { data: newPersonId, error } = await supabase.rpc("create_related_person", {
    p_given_name: givenName,
    p_family_name: familyName,
    p_gender: input.gender,
    p_edges: edges,
  });

  if (error || !newPersonId) {
    return { ok: false, error: "Kunne ikke opprette personen." };
  }

  return { ok: true, newPersonId: newPersonId as string };
}
