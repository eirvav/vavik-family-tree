"use client";

import { useState } from "react";
import type { Person, Relationship } from "@/lib/family-tree/data";
import { searchPeople } from "@/lib/family-tree/search";
import { DetailPanel } from "./detail-panel";

export function ListView({
  people,
  relationships,
}: {
  people: Person[];
  relationships: Relationship[];
}) {
  const [query, setQuery] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<"compact" | "full" | null>(null);

  const filtered = query.trim() ? searchPeople(people, query) : people;
  const sorted = [...filtered].sort((a, b) => a.family_name.localeCompare(b.family_name, "nb"));
  const peopleById = new Map(people.map((p) => [p.id, p]));

  const handleSelectPerson = (personId: string) => {
    setSelectedPersonId(personId);
    setPanelMode("compact");
  };

  const handleClosePanel = () => {
    setSelectedPersonId(null);
    setPanelMode(null);
  };

  const handleExpandPanel = () => {
    setPanelMode("full");
  };

  return (
    <div className="relative h-full w-full flex">
      <div className="flex-1 overflow-y-auto p-6">
        <label htmlFor="liste-sok" className="text-sm font-medium text-foreground">
          Søk
        </label>
        <input
          id="liste-sok"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mt-1.5 w-full max-w-sm rounded-lg border border-line bg-background px-3.5 py-2.5 text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        <ul className="mt-4 flex flex-col gap-1">
          {sorted.map((person) => (
            <li key={person.id}>
              <button
                onClick={() => handleSelectPerson(person.id)}
                className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-left text-sm text-foreground hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                {person.given_name} {person.family_name}
                {person.birth_date_display && (
                  <span className="ml-2 text-muted">({person.birth_date_display})</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {selectedPersonId && panelMode && (
        <DetailPanel
          person={peopleById.get(selectedPersonId)!}
          relationships={relationships}
          peopleById={peopleById}
          mode={panelMode}
          onClose={handleClosePanel}
          onExpand={handleExpandPanel}
          onSelectPerson={handleSelectPerson}
        />
      )}
    </div>
  );
}
