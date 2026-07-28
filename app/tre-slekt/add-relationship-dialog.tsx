"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Person } from "@/lib/family-tree/data";
import { createRelatedPerson } from "./actions";

type Kind = "father" | "mother" | "sibling" | "partner" | "child";

const KIND_LABEL_NO: Record<Kind, string> = {
  father: "Legg til far",
  mother: "Legg til mor",
  sibling: "Legg til søsken",
  partner: "Legg til partner",
  child: "Legg til barn",
};

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

export function AddRelationshipDialog({
  kind,
  selectedPerson,
  partners,
  onClose,
  onCreated,
}: {
  kind: Kind;
  selectedPerson: Person;
  partners: Person[];
  onClose: () => void;
  onCreated: (newPersonId: string) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState(kind === "partner" ? "" : selectedPerson.family_name);
  const [gender, setGender] = useState<Person["gender"]>(
    kind === "father" ? "male" : kind === "mother" ? "female" : "unknown"
  );

  const showGenderSelector = kind === "sibling" || kind === "partner" || kind === "child";
  const showTypeSelector = kind !== "sibling";
  const typeOptions = kind === "partner" ? PARTNER_TYPE_OPTIONS : PARENT_TYPE_OPTIONS;
  const [relationshipType, setRelationshipType] = useState(typeOptions[0].value);
  const [secondParentId, setSecondParentId] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createRelatedPerson({
        selectedPersonId: selectedPerson.id,
        kind,
        givenName,
        familyName,
        gender,
        relationshipType,
        secondParentId: secondParentId || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onCreated(result.newPersonId);
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-lg">
        <h2 className="font-serif text-lg font-medium text-foreground">{KIND_LABEL_NO[kind]}</h2>
        {error && <p className="mt-3 text-sm text-error">{error}</p>}
        <label className="mt-4 flex flex-col gap-1 text-sm">
          Fornavn
          <input
            value={givenName}
            onChange={(e) => setGivenName(e.target.value)}
            required
            autoFocus
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>
        <label className="mt-3 flex flex-col gap-1 text-sm">
          Etternavn
          <input
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            required
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>
        {showGenderSelector && (
          <label className="mt-3 flex flex-col gap-1 text-sm">
            Kjønn
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as Person["gender"])}
              className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
            >
              <option value="male">Mann</option>
              <option value="female">Kvinne</option>
              <option value="unknown">Ikke oppgitt</option>
            </select>
          </label>
        )}
        {showTypeSelector && (
          <label className="mt-3 flex flex-col gap-1 text-sm">
            Relasjonstype
            <select
              value={relationshipType}
              onChange={(e) => setRelationshipType(e.target.value)}
              className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
            >
              {typeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "child" && partners.length > 0 && (
          <label className="mt-3 flex flex-col gap-1 text-sm">
            Sammen med (valgfritt)
            <select
              value={secondParentId}
              onChange={(e) => setSecondParentId(e.target.value)}
              className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
            >
              <option value="">Ingen valgt</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.given_name} {p.family_name}
                </option>
              ))}
            </select>
          </label>
        )}
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
