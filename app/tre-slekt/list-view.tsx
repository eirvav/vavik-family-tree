"use client";

import { useState } from "react";
import type { Person, Relationship } from "@/lib/family-tree/data";
import { searchPeople } from "@/lib/family-tree/search";
import { DetailPanel } from "./detail-panel";
import { GENDER_ICON } from "./person-node";

// Groups the sorted list under a letter-of-the-family-name index, like a
// physical archive's card catalog — meaningful once ~250 people span many
// different family names, not just decoration for the seed data's single one.
function groupByFamilyNameInitial(sorted: Person[]) {
  const groups: { letter: string; people: Person[] }[] = [];
  for (const person of sorted) {
    const letter = person.family_name.charAt(0).toLocaleUpperCase("nb");
    const currentGroup = groups[groups.length - 1];
    if (currentGroup && currentGroup.letter === letter) {
      currentGroup.people.push(person);
    } else {
      groups.push({ letter, people: [person] });
    }
  }
  return groups;
}

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
  const groups = groupByFamilyNameInitial(sorted);
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
    <div className="relative flex h-full w-full">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-sm">
          <label htmlFor="liste-sok" className="text-sm font-medium text-foreground">
            Søk
          </label>
          <div className="relative mt-1.5">
            <svg
              width="14"
              height="14"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            >
              <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M16 16L12.8 12.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              id="liste-sok"
              type="text"
              placeholder="Navn eller sted"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-lg border border-line bg-background py-2.5 pl-8 pr-3.5 text-foreground placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>
        </div>

        <div className="mt-6 max-w-2xl">
          {groups.length === 0 && <p className="text-sm text-muted">Ingen treff</p>}
          {groups.map((group) => (
            <div key={group.letter} className="mb-6">
              <div className="flex items-center gap-3">
                <span className="font-serif text-lg text-gold">{group.letter}</span>
                <span className="h-px flex-1 bg-line" aria-hidden="true" />
              </div>
              <ul className="mt-2 flex flex-col gap-1">
                {group.people.map((person) => (
                  <li key={person.id}>
                    <button
                      onClick={() => handleSelectPerson(person.id)}
                      className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 text-left text-sm hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-background text-xs text-muted"
                        aria-hidden="true"
                      >
                        {GENDER_ICON[person.gender]}
                      </span>
                      <span className="font-serif text-foreground">
                        {person.given_name} {person.family_name}
                      </span>
                      {person.birth_date_display && (
                        <span className="text-muted">({person.birth_date_display})</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
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
