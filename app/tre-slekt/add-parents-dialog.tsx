"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createParentPair } from "./actions";

const PARENT_TYPE_OPTIONS = [
  { value: "biological_parent", label: "Biologisk" },
  { value: "adoptive_parent", label: "Adoptiv" },
  { value: "foster_parent", label: "Foster" },
  { value: "guardian_parent", label: "Verge" },
];

const PARTNER_TYPE_OPTIONS = [
  { value: "spouse", label: "Ektefelle" },
  { value: "former_spouse", label: "Tidligere ektefelle" },
  { value: "partner", label: "Partner" },
  { value: "former_partner", label: "Tidligere partner" },
];

export function AddParentsDialog({
  childId,
  onClose,
  onCreated,
}: {
  childId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [fatherGivenName, setFatherGivenName] = useState("");
  const [fatherFamilyName, setFatherFamilyName] = useState("");
  const [motherGivenName, setMotherGivenName] = useState("");
  const [motherFamilyName, setMotherFamilyName] = useState("");
  const [parentRelationshipType, setParentRelationshipType] = useState(PARENT_TYPE_OPTIONS[0].value);
  const [partnerRelationshipType, setPartnerRelationshipType] = useState(PARTNER_TYPE_OPTIONS[0].value);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createParentPair({
        childId,
        fatherGivenName,
        fatherFamilyName,
        motherGivenName,
        motherFamilyName,
        parentRelationshipType,
        partnerRelationshipType,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onCreated();
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-lg">
        <h2 className="font-serif text-lg font-medium text-foreground">Legg til foreldre</h2>
        {error && <p className="mt-3 text-sm text-error">{error}</p>}

        <p className="mt-4 text-sm font-medium text-foreground">Far</p>
        <label className="mt-2 flex flex-col gap-1 text-sm">
          Fornavn
          <input
            value={fatherGivenName}
            onChange={(e) => setFatherGivenName(e.target.value)}
            required
            autoFocus
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>
        <label className="mt-2 flex flex-col gap-1 text-sm">
          Etternavn
          <input
            value={fatherFamilyName}
            onChange={(e) => setFatherFamilyName(e.target.value)}
            required
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>

        <p className="mt-4 text-sm font-medium text-foreground">Mor</p>
        <label className="mt-2 flex flex-col gap-1 text-sm">
          Fornavn
          <input
            value={motherGivenName}
            onChange={(e) => setMotherGivenName(e.target.value)}
            required
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>
        <label className="mt-2 flex flex-col gap-1 text-sm">
          Etternavn
          <input
            value={motherFamilyName}
            onChange={(e) => setMotherFamilyName(e.target.value)}
            required
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>

        <label className="mt-4 flex flex-col gap-1 text-sm">
          Relasjonstype (foreldre → barn)
          <select
            value={parentRelationshipType}
            onChange={(e) => setParentRelationshipType(e.target.value)}
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          >
            {PARENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 flex flex-col gap-1 text-sm">
          Relasjonstype (far ↔ mor)
          <select
            value={partnerRelationshipType}
            onChange={(e) => setPartnerRelationshipType(e.target.value)}
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          >
            {PARTNER_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-5 flex gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            Opprett
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
      </form>
    </div>
  );
}
