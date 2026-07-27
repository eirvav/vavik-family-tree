"use client";

import { useState } from "react";
import type { Person, Relationship, CanvasPositionRow } from "@/lib/family-tree/data";
import { FamilyTreeCanvas } from "./canvas";
import { ListView } from "./list-view";

export function ViewWrapper({
  people,
  relationships,
  positions,
  canEdit,
  isAdmin,
}: {
  people: Person[];
  relationships: Relationship[];
  positions: CanvasPositionRow[];
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const [viewMode, setViewMode] = useState<"tre" | "liste">("tre");

  return (
    <div className="flex h-screen w-full flex-col">
      <div className="flex gap-2 border-b border-line bg-surface px-4 py-3">
        <button
          onClick={() => setViewMode("tre")}
          className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
            viewMode === "tre"
              ? "border-accent bg-background text-foreground"
              : "border-line bg-surface text-foreground hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          }`}
        >
          Tre
        </button>
        <button
          onClick={() => setViewMode("liste")}
          className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
            viewMode === "liste"
              ? "border-accent bg-background text-foreground"
              : "border-line bg-surface text-foreground hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          }`}
        >
          Liste
        </button>
      </div>
      <div className="flex-1">
        {viewMode === "tre" && (
          <FamilyTreeCanvas
            people={people}
            relationships={relationships}
            positions={positions}
            canEdit={canEdit}
            isAdmin={isAdmin}
          />
        )}
        {viewMode === "liste" && <ListView people={people} relationships={relationships} />}
      </div>
    </div>
  );
}
