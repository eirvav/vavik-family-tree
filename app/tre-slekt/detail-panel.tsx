"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Person, Relationship } from "@/lib/family-tree/data";
import { updatePersonInfo, updatePersonBiography } from "./actions";

const RELATIONSHIP_LABEL_NO: Record<Relationship["relationship_type"], { asParent: string; asChild: string }> = {
  biological_parent: { asParent: "forelder", asChild: "barn" },
  adoptive_parent: { asParent: "adoptivforelder", asChild: "adoptivbarn" },
  foster_parent: { asParent: "fosterforelder", asChild: "fosterbarn" },
  guardian_parent: { asParent: "verge", asChild: "myndling" },
  spouse: { asParent: "ektefelle", asChild: "ektefelle" },
  former_spouse: { asParent: "tidligere ektefelle", asChild: "tidligere ektefelle" },
  partner: { asParent: "partner", asChild: "partner" },
  former_partner: { asParent: "tidligere partner", asChild: "tidligere partner" },
  sibling: { asParent: "søsken", asChild: "søsken" },
};

const GENDER_LABEL_NO: Record<Person["gender"], string> = {
  male: "Mann",
  female: "Kvinne",
  unknown: "Ikke oppgitt",
};

export function DetailPanel({
  person,
  relationships,
  peopleById,
  canEdit,
  isAdmin,
  onClose,
  onSelectPerson,
}: {
  person: Person;
  relationships: Relationship[];
  peopleById: Map<string, Person>;
  canEdit: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onSelectPerson: (personId: string) => void;
}) {
  const [tab, setTab] = useState<"info" | "bio">("info");

  const related = relationships
    .filter((r) => r.person_a_id === person.id || r.person_b_id === person.id)
    .map((r) => {
      const isA = r.person_a_id === person.id;
      const otherId = isA ? r.person_b_id : r.person_a_id;
      const other = peopleById.get(otherId);
      // person_a_id is the parent for parent/child relationship types (matches
      // the Dagre layout direction in lib/family-tree/layout.ts), so when the
      // viewed person IS person_a, the OTHER person is their child.
      const label = isA ? RELATIONSHIP_LABEL_NO[r.relationship_type].asChild : RELATIONSHIP_LABEL_NO[r.relationship_type].asParent;
      return other ? { other, label } : null;
    })
    .filter((x): x is { other: Person; label: string } => x !== null);

  return (
    <aside className="absolute right-0 top-0 h-full w-96 overflow-y-auto border-l border-line bg-surface p-6 shadow-lg">
      <button onClick={onClose} className="text-sm text-muted hover:text-foreground" aria-label="Lukk">
        Lukk ✕
      </button>
      <h2 className="mt-4 font-serif text-xl font-medium text-foreground">
        {person.given_name} {person.family_name}
      </h2>

      <div role="group" aria-label="Faner" className="mt-4 inline-flex gap-1 rounded-full border border-line bg-background p-1">
        <button
          onClick={() => setTab("info")}
          aria-pressed={tab === "info"}
          className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
            tab === "info" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"
          }`}
        >
          Personinfo
        </button>
        <button
          onClick={() => setTab("bio")}
          aria-pressed={tab === "bio"}
          className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
            tab === "bio" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"
          }`}
        >
          Biografi
        </button>
      </div>

      {tab === "info" ? (
        <PersonInfoTab key={person.id} person={person} isAdmin={isAdmin} related={related} onSelectPerson={onSelectPerson} />
      ) : (
        <BiographyTab key={person.id} person={person} canEdit={canEdit} />
      )}
    </aside>
  );
}

function PersonInfoTab({
  person,
  isAdmin,
  related,
  onSelectPerson,
}: {
  person: Person;
  isAdmin: boolean;
  related: { other: Person; label: string }[];
  onSelectPerson: (personId: string) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [givenName, setGivenName] = useState(person.given_name);
  const [familyName, setFamilyName] = useState(person.family_name);
  const [birthFamilyName, setBirthFamilyName] = useState(person.birth_family_name ?? "");
  const [gender, setGender] = useState<Person["gender"]>(person.gender);
  const [birthDateDisplay, setBirthDateDisplay] = useState(person.birth_date_display ?? "");
  const [isLiving, setIsLiving] = useState(person.is_living);
  const [deathDateDisplay, setDeathDateDisplay] = useState(person.death_date_display ?? "");

  const handleCancel = () => {
    setGivenName(person.given_name);
    setFamilyName(person.family_name);
    setBirthFamilyName(person.birth_family_name ?? "");
    setGender(person.gender);
    setBirthDateDisplay(person.birth_date_display ?? "");
    setIsLiving(person.is_living);
    setDeathDateDisplay(person.death_date_display ?? "");
    setError(null);
    setEditing(false);
  };

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      const result = await updatePersonInfo({
        personId: person.id,
        givenName,
        familyName,
        birthFamilyName,
        gender,
        birthDateDisplay,
        isLiving,
        deathDateDisplay,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  if (editing) {
    return (
      <div className="mt-4 flex flex-col gap-3">
        {error && <p className="text-sm text-error">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          Fornavn
          <input
            value={givenName}
            onChange={(e) => setGivenName(e.target.value)}
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Etternavn
          <input
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Etternavn ved fødsel
          <input
            value={birthFamilyName}
            onChange={(e) => setBirthFamilyName(e.target.value)}
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
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
        <label className="flex flex-col gap-1 text-sm">
          Fødselsdato
          <input
            value={birthDateDisplay}
            onChange={(e) => setBirthDateDisplay(e.target.value)}
            placeholder="f.eks. 12. mars 1955"
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!isLiving} onChange={(e) => setIsLiving(!e.target.checked)} />
          Avdød
        </label>
        {!isLiving && (
          <label className="flex flex-col gap-1 text-sm">
            Dødsdato
            <input
              value={deathDateDisplay}
              onChange={(e) => setDeathDateDisplay(e.target.value)}
              placeholder="f.eks. 3. januar 2010"
              className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
            />
          </label>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={isPending}
            className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            Lagre
          </button>
          <button
            onClick={handleCancel}
            disabled={isPending}
            className="flex-1 rounded-lg border border-line px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
          >
            Avbryt
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-1">
      {isAdmin && (
        <button
          onClick={() => setEditing(true)}
          className="mb-2 self-start rounded-lg border border-line px-3 py-1 text-xs font-medium text-foreground hover:bg-background"
        >
          Rediger
        </button>
      )}
      <p className="text-sm text-foreground">
        {person.given_name} {person.family_name}
      </p>
      {person.birth_family_name && <p className="text-sm text-muted">Født {person.birth_family_name}</p>}
      <p className="text-sm text-muted">{GENDER_LABEL_NO[person.gender]}</p>
      <p className="text-sm text-muted">
        {[person.birth_date_display, person.death_date_display].filter(Boolean).join(" – ") || "Ukjente datoer"}
      </p>
      <p className="text-sm text-muted">{person.is_living ? "Lever" : "Avdød"}</p>

      <h3 className="mt-6 text-sm font-medium text-foreground">Familie</h3>
      <ul className="mt-2 flex flex-col gap-1">
        {related.map(({ other, label }) => (
          <li key={other.id}>
            <button
              onClick={() => onSelectPerson(other.id)}
              className="text-sm text-accent underline underline-offset-2 hover:text-accent-hover"
            >
              {other.given_name} {other.family_name}
            </button>
            <span className="ml-1 text-xs text-muted">({label})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BiographyTab({ person, canEdit }: { person: Person; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [biography, setBiography] = useState(person.biography ?? "");

  const handleCancel = () => {
    setBiography(person.biography ?? "");
    setError(null);
    setEditing(false);
  };

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      const result = await updatePersonBiography({ personId: person.id, biography });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  if (editing) {
    return (
      <div className="mt-4 flex flex-col gap-3">
        {error && <p className="text-sm text-error">{error}</p>}
        <textarea
          value={biography}
          onChange={(e) => setBiography(e.target.value)}
          rows={12}
          className="rounded-lg border border-line bg-background px-3 py-2 text-sm text-foreground"
        />
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={isPending}
            className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            Lagre
          </button>
          <button
            onClick={handleCancel}
            disabled={isPending}
            className="flex-1 rounded-lg border border-line px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
          >
            Avbryt
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      {canEdit && (
        <button
          onClick={() => setEditing(true)}
          className="self-start rounded-lg border border-line px-3 py-1 text-xs font-medium text-foreground hover:bg-background"
        >
          Rediger
        </button>
      )}
      <p className="whitespace-pre-wrap text-sm text-foreground">{person.biography || "Ingen biografi ennå."}</p>
    </div>
  );
}
