"use client";

import { useState } from "react";
import type { Person } from "@/lib/family-tree/data";

type Kind = "father" | "mother" | "sibling" | "partner" | "child";

export function ActionBar({
  selectedPerson,
  onAdd,
  onDelete,
}: {
  selectedPerson: Person;
  onAdd: (kind: Kind) => void;
  onDelete: () => void;
}) {
  const [showParentPopover, setShowParentPopover] = useState(false);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-center gap-1 rounded-t-2xl border-t border-line bg-surface p-2 shadow-lg sm:absolute sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:z-10 sm:w-auto sm:-translate-x-1/2 sm:flex-nowrap sm:rounded-full sm:border sm:p-1.5"
      aria-label={`Handlinger for ${selectedPerson.given_name} ${selectedPerson.family_name}`}
    >
      <div
        className="relative"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setShowParentPopover(false);
        }}
      >
        <ActionButton
          icon={<ParentIcon />}
          label="Forelder"
          onClick={() => setShowParentPopover((v) => !v)}
        />
        {showParentPopover && (
          <div className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 gap-1 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
            <button
              onClick={() => {
                setShowParentPopover(false);
                onAdd("father");
              }}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-background"
            >
              <span aria-hidden="true">♂</span> Far
            </button>
            <button
              onClick={() => {
                setShowParentPopover(false);
                onAdd("mother");
              }}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-background"
            >
              <span aria-hidden="true">♀</span> Mor
            </button>
          </div>
        )}
      </div>
      <ActionButton icon={<SiblingIcon />} label="Søsken" onClick={() => onAdd("sibling")} />
      <ActionButton icon={<PartnerIcon />} label="Partner" onClick={() => onAdd("partner")} />
      <ActionButton icon={<ChildIcon />} label="Barn" onClick={() => onAdd("child")} />
      <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
      <ActionButton icon={<TrashIcon />} label="Slett" onClick={onDelete} destructive />
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
        destructive ? "text-error hover:bg-error/10" : "text-foreground hover:bg-background"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ParentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 17c0-3 2.2-5.5 5-5.5s5 2.5 5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M15.5 4v4M13.5 6h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SiblingIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="6.5" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="13.5" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M2.5 16.5c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5M11.5 16.5c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PartnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M10 17S3 12.5 3 7.8C3 5.1 5 3.5 7.2 3.5c1.3 0 2.4.6 2.8 1.6.4-1 1.5-1.6 2.8-1.6C15 3.5 17 5.1 17 7.8 17 12.5 10 17 10 17Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChildIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="10" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 17c0-2.8 2-5 4.5-5s4.5 2.2 4.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M4 6h12M8 6V4.5a1 1 0 011-1h2a1 1 0 011 1V6M6 6l.6 9.5a1 1 0 001 .9h4.8a1 1 0 001-.9L14 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8.5 9v4M11.5 9v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
