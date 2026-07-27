"use client";

import type { Person, Relationship } from "@/lib/family-tree/data";

const RELATIONSHIP_LABEL_NO: Record<Relationship["relationship_type"], { asParent: string; asChild: string }> = {
  biological_parent: { asParent: "forelder", asChild: "barn" },
  adoptive_parent: { asParent: "adoptivforelder", asChild: "adoptivbarn" },
  foster_parent: { asParent: "fosterforelder", asChild: "fosterbarn" },
  guardian_parent: { asParent: "verge", asChild: "myndling" },
  spouse: { asParent: "ektefelle", asChild: "ektefelle" },
  former_spouse: { asParent: "tidligere ektefelle", asChild: "tidligere ektefelle" },
  partner: { asParent: "partner", asChild: "partner" },
  former_partner: { asParent: "tidligere partner", asChild: "tidligere partner" },
};

export function DetailPanel({
  person,
  relationships,
  peopleById,
  mode,
  onClose,
  onExpand,
  onSelectPerson,
}: {
  person: Person;
  relationships: Relationship[];
  peopleById: Map<string, Person>;
  mode: "compact" | "full";
  onClose: () => void;
  onExpand: () => void;
  onSelectPerson: (personId: string) => void;
}) {
  const related = relationships
    .filter((r) => r.person_a_id === person.id || r.person_b_id === person.id)
    .map((r) => {
      const isA = r.person_a_id === person.id;
      const otherId = isA ? r.person_b_id : r.person_a_id;
      const other = peopleById.get(otherId);
      const label = isA ? RELATIONSHIP_LABEL_NO[r.relationship_type].asParent : RELATIONSHIP_LABEL_NO[r.relationship_type].asChild;
      return other ? { other, label } : null;
    })
    .filter((x): x is { other: Person; label: string } => x !== null);

  return (
    <aside className="absolute right-0 top-0 h-full w-80 overflow-y-auto border-l border-line bg-surface p-6 shadow-lg">
      <button onClick={onClose} className="text-sm text-muted hover:text-foreground" aria-label="Lukk">
        Lukk ✕
      </button>
      <h2 className="mt-4 font-serif text-xl font-medium text-foreground">
        {person.given_name} {person.family_name}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {[person.birth_date_display, person.death_date_display].filter(Boolean).join(" – ") || "Ukjente datoer"}
      </p>
      {person.birth_place && <p className="mt-1 text-sm text-muted">Født: {person.birth_place}</p>}
      {mode === "full" && person.death_place && <p className="text-sm text-muted">Død: {person.death_place}</p>}

      {mode === "full" && person.biography && (
        <p className="mt-4 whitespace-pre-wrap text-sm text-foreground">{person.biography}</p>
      )}

      <h3 className="mt-6 text-sm font-medium text-foreground">Familie</h3>
      <ul className="mt-2 flex flex-col gap-1">
        {related.map(({ other, label }) => (
          <li key={other.id}>
            <button
              onClick={() => onSelectPerson(other.id)}
              className="text-sm text-accent underline underline-offset-2 hover:text-accent-hover"
            >
              {other.given_name} {other.family_name}
            </button>
            <span className="ml-1 text-xs text-muted">({label})</span>
          </li>
        ))}
      </ul>

      {mode === "compact" && (
        <button
          onClick={onExpand}
          className="mt-6 w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Se full profil
        </button>
      )}
    </aside>
  );
}
