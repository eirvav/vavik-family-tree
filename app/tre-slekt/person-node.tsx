"use client";

import { Handle, Position } from "@xyflow/react";
import type { Person } from "@/lib/family-tree/data";

const GENDER_ICON: Record<Person["gender"], string> = {
  male: "♂",
  female: "♀",
  unknown: "•",
};

export function PersonNode({ data }: { data: { person: Person } }) {
  const { person } = data;
  const years = [person.birth_date_display, person.death_date_display].filter(Boolean).join(" – ");

  return (
    <div
      className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-sm"
      role="group"
      aria-label={`${person.given_name} ${person.family_name}${years ? `, ${years}` : ""}`}
    >
      <Handle type="target" position={Position.Top} />
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-background text-sm text-muted"
        aria-hidden="true"
      >
        {GENDER_ICON[person.gender]}
      </span>
      <div className="flex flex-col">
        <span className="text-sm font-medium text-foreground">
          {person.given_name} {person.family_name}
        </span>
        {years && <span className="text-xs text-muted">{years}</span>}
      </div>
      {!person.is_living && (
        <span className="ml-1 h-2 w-2 shrink-0 rounded-full bg-muted" aria-label="Avdød" title="Avdød" />
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
