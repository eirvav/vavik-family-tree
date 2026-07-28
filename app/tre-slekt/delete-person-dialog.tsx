"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Person } from "@/lib/family-tree/data";
import { deletePerson } from "./actions";

export function DeletePersonDialog({
  person,
  onClose,
  onDeleted,
}: {
  person: Person;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      const result = await deletePerson(person.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDeleted();
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-foreground/20 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-lg">
        <h2 className="font-serif text-lg font-medium text-foreground">
          Slett {person.given_name} {person.family_name}?
        </h2>
        <p className="mt-2 text-sm text-muted">Dette kan ikke angres fra denne skjermen.</p>
        {error && <p className="mt-3 text-sm text-error">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button
            onClick={handleConfirm}
            disabled={isPending}
            className="flex-1 rounded-lg bg-error px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            Slett
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="flex-1 rounded-lg border border-line px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
          >
            Avbryt
          </button>
        </div>
      </div>
    </div>
  );
}
