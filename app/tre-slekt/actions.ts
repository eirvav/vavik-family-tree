"use server";

import { createClient } from "@/lib/supabase/server";
import type { Relationship } from "@/lib/family-tree/data";
import { getFamilyTreeData } from "@/lib/family-tree/data";
import { checkDeleteConnectivity } from "@/lib/family-tree/connectivity";

const PARENT_RELATIONSHIP_TYPES = new Set<Relationship["relationship_type"]>([
  "biological_parent",
  "adoptive_parent",
  "foster_parent",
  "guardian_parent",
]);

type RelationKind = "sibling" | "partner" | "child";

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

  return { ok: true as const, supabase, user };
}

export async function createRelatedPerson(input: {
  selectedPersonId: string;
  kind: RelationKind;
  givenName: string;
  familyName: string;
  gender: "male" | "female" | "unknown";
  relationshipType: string;
  secondParentId?: string;
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

  if (input.kind === "child") {
    // Selected person is the parent (person_a); the new person is the child (person_b).
    edges = [{ other_person_id: input.selectedPersonId, relationship_type: input.relationshipType, new_person_is_a: false }];
    if (input.secondParentId) {
      edges.push({ other_person_id: input.secondParentId, relationship_type: input.relationshipType, new_person_is_a: false });
    }
  } else if (input.kind === "partner") {
    edges = [{ other_person_id: input.selectedPersonId, relationship_type: input.relationshipType, new_person_is_a: false }];
  } else {
    // sibling: always create a direct sibling edge to the selected person
    // (this is what makes the feature work with no parent on file). If the
    // selected person has active parent(s) recorded, additionally mirror
    // those same links onto the new sibling — extra detail when available,
    // never a precondition.
    edges = [{ other_person_id: input.selectedPersonId, relationship_type: "sibling", new_person_is_a: false }];

    const { data: parentLinks, error: parentError } = await supabase
      .from("relationships")
      .select("person_a_id, relationship_type")
      .eq("person_b_id", input.selectedPersonId)
      .in("relationship_type", [...PARENT_RELATIONSHIP_TYPES])
      .is("deleted_at", null);

    if (parentError) {
      return { ok: false, error: "Kunne ikke hente foreldre." };
    }

    for (const link of parentLinks ?? []) {
      edges.push({
        other_person_id: link.person_a_id,
        relationship_type: link.relationship_type,
        new_person_is_a: false,
      });
    }
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

export async function updatePersonInfo(input: {
  personId: string;
  givenName: string;
  familyName: string;
  birthFamilyName: string;
  gender: "male" | "female" | "unknown";
  birthDateDisplay: string;
  isLiving: boolean;
  deathDateDisplay: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;
  const { supabase, user } = authCheck;

  const givenName = input.givenName.trim();
  const familyName = input.familyName.trim();
  if (!givenName || !familyName) {
    return { ok: false, error: "Fornavn og etternavn må fylles ut." };
  }

  const { data: current, error: fetchError } = await supabase
    .from("people")
    .select("version")
    .eq("id", input.personId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError || !current) {
    return { ok: false, error: "Fant ikke personen." };
  }

  const { error } = await supabase
    .from("people")
    .update({
      given_name: givenName,
      family_name: familyName,
      birth_family_name: input.birthFamilyName.trim() || null,
      gender: input.gender,
      birth_date_display: input.birthDateDisplay.trim() || null,
      is_living: input.isLiving,
      death_date_display: input.isLiving ? null : input.deathDateDisplay.trim() || null,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
      version: current.version + 1,
    })
    .eq("id", input.personId)
    .is("deleted_at", null);

  if (error) {
    return { ok: false, error: "Kunne ikke lagre personinfo." };
  }

  return { ok: true };
}

export async function updatePersonBiography(input: {
  personId: string;
  biography: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Ikke logget inn." };

  const { error } = await supabase.rpc("update_person_biography", {
    p_person_id: input.personId,
    p_biography: input.biography.trim() || null,
  });

  if (error) {
    return { ok: false, error: "Kunne ikke lagre biografien." };
  }

  return { ok: true };
}

export async function deletePerson(personId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;
  const { supabase } = authCheck;

  const { people, relationships } = await getFamilyTreeData();
  const target = people.find((p) => p.id === personId);
  if (!target) {
    return { ok: false, error: "Fant ikke personen." };
  }

  const check = checkDeleteConnectivity(people, relationships, personId);
  if (!check.safe) {
    const names = check.disconnectedPeople.map((p) => `${p.given_name} ${p.family_name}`).join(", ");
    return {
      ok: false,
      error: `Kan ikke slette ${target.given_name} ${target.family_name} — ${names} ville da miste kontakt med resten av treet. Slett dem først.`,
    };
  }

  const { error } = await supabase.rpc("delete_person", { p_person_id: personId });
  if (error) {
    return { ok: false, error: "Sletting feilet." };
  }

  return { ok: true };
}

export async function createParentPair(input: {
  childId: string;
  fatherGivenName: string;
  fatherFamilyName: string;
  motherGivenName: string;
  motherFamilyName: string;
  parentRelationshipType: string;
  partnerRelationshipType: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;
  const { supabase } = authCheck;

  const fatherGivenName = input.fatherGivenName.trim();
  const fatherFamilyName = input.fatherFamilyName.trim();
  const motherGivenName = input.motherGivenName.trim();
  const motherFamilyName = input.motherFamilyName.trim();
  if (!fatherGivenName || !fatherFamilyName || !motherGivenName || !motherFamilyName) {
    return { ok: false, error: "Alle navnefelt må fylles ut." };
  }

  const { error } = await supabase.rpc("create_parent_pair", {
    p_father_given_name: fatherGivenName,
    p_father_family_name: fatherFamilyName,
    p_mother_given_name: motherGivenName,
    p_mother_family_name: motherFamilyName,
    p_parent_relationship_type: input.parentRelationshipType,
    p_partner_relationship_type: input.partnerRelationshipType,
    p_child_id: input.childId,
  });

  if (error) {
    return { ok: false, error: "Kunne ikke opprette foreldrene." };
  }

  return { ok: true };
}
