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
      <div className="flex items-center border-b border-line bg-surface px-4 py-3">
        <div
          role="group"
          aria-label="Visningsmodus"
          className="inline-flex gap-1 rounded-full border border-line bg-background p-1"
        >
          <button
            onClick={() => setViewMode("tre")}
            aria-pressed={viewMode === "tre"}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              viewMode === "tre" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
              <path
                d="M10 17V9M10 9C10 9 10 2.5 4.5 2.5M10 9C10 9 10 2.5 15.5 2.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            Tre
          </button>
          <button
            onClick={() => setViewMode("liste")}
            aria-pressed={viewMode === "liste"}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              viewMode === "liste" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
              <path d="M4 5.5H16M4 10H16M4 14.5H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Liste
          </button>
        </div>
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
