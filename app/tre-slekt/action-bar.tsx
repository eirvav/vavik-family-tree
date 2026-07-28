"use client";

import type { Person, Relationship } from "@/lib/family-tree/data";

type Kind = "father" | "mother" | "sibling" | "partner" | "child";

const PARENT_RELATIONSHIP_TYPES = new Set<Relationship["relationship_type"]>([
  "biological_parent",
  "adoptive_parent",
  "foster_parent",
  "guardian_parent",
]);

export function ActionBar({
  selectedPerson,
  relationships,
  onAdd,
  onDelete,
}: {
  selectedPerson: Person;
  relationships: Relationship[];
  onAdd: (kind: Kind) => void;
  onDelete: () => void;
}) {
  const hasParent = relationships.some(
    (r) => r.person_b_id === selectedPerson.id && PARENT_RELATIONSHIP_TYPES.has(r.relationship_type)
  );

  return (
    <div className="absolute bottom-6 left-[calc(50%-12rem)] z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-surface p-1.5 shadow-lg">
      <ActionButton label="Legg til far" onClick={() => onAdd("father")} />
      <ActionButton label="Legg til mor" onClick={() => onAdd("mother")} />
      <ActionButton
        label="Legg til søsken"
        onClick={() => onAdd("sibling")}
        disabled={!hasParent}
        disabledReason="Legg til en forelder først"
      />
      <ActionButton label="Legg til partner" onClick={() => onAdd("partner")} />
      <ActionButton label="Legg til barn" onClick={() => onAdd("child")} />
      <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
      <ActionButton label="Slett person" onClick={onDelete} destructive />
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  disabledReason,
  destructive,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className={`rounded-full px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        destructive ? "text-error hover:bg-error/10" : "text-foreground hover:bg-background"
      }`}
    >
      {label}
    </button>
  );
}
