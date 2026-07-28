"use client";

import { useState, useEffect } from "react";
import type { Person, Relationship } from "@/lib/family-tree/data";
import { FamilyTreeCanvas } from "./canvas";
import { ListView } from "./list-view";

export function ViewWrapper({
  people,
  relationships,
  canEdit,
  isAdmin,
}: {
  people: Person[];
  relationships: Relationship[];
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const [viewMode, setViewMode] = useState<"tre" | "liste">("tre");
  const [orientation, setOrientation] = useState<"tb" | "lr">("tb");

  // Client-side hydration: read localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    const saved = localStorage.getItem("familietre-orientasjon");
    if (saved === "tb" || saved === "lr") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOrientation(saved);
    }
  }, []);

  const handleSetOrientation = (next: "tb" | "lr") => {
    setOrientation(next);
    localStorage.setItem("familietre-orientasjon", next);
  };

  return (
    <div className="flex h-screen w-full flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
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

        {viewMode === "tre" && (
          <div
            role="group"
            aria-label="Retning på treet"
            className="inline-flex gap-1 rounded-full border border-line bg-background p-1"
          >
            <button
              onClick={() => handleSetOrientation("tb")}
              aria-pressed={orientation === "tb"}
              title="Topp til bunn"
              className={`flex items-center justify-center rounded-full p-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                orientation === "tb" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M10 3V17M10 17L6 13M10 17L14 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="sr-only">Topp til bunn</span>
            </button>
            <button
              onClick={() => handleSetOrientation("lr")}
              aria-pressed={orientation === "lr"}
              title="Venstre til høyre"
              className={`flex items-center justify-center rounded-full p-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                orientation === "lr" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 10H17M17 10L13 6M17 10L13 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="sr-only">Venstre til høyre</span>
            </button>
          </div>
        )}
      </div>
      <div className="relative flex-1">
        {/* Both views stay mounted and are shown/hidden via CSS rather than
            conditional rendering, so that switching between tree and list
            views doesn't unmount/remount the List view and lose its internal
            scroll state. */}
        <div className={`absolute inset-0 ${viewMode === "tre" ? "" : "hidden"}`}>
          <FamilyTreeCanvas
            people={people}
            relationships={relationships}
            canEdit={canEdit}
            isAdmin={isAdmin}
            orientation={orientation}
          />
        </div>
        <div className={`absolute inset-0 ${viewMode === "liste" ? "" : "hidden"}`}>
          <ListView people={people} relationships={relationships} canEdit={canEdit} isAdmin={isAdmin} />
        </div>
      </div>
    </div>
  );
}
