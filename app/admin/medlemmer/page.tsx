import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { opprettMedlem } from "./actions";

export default async function MedlemmerPage({
  searchParams,
}: {
  searchParams: Promise<{ feil?: string; opprettet?: string }>;
}) {
  const { feil, opprettet } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/logg-inn");
  }

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (callerProfile?.role !== "admin") {
    redirect("/tre");
  }

  const { data: medlemmer } = await supabase
    .from("profiles")
    .select("user_id, email, first_name, last_name, role")
    .order("last_name", { ascending: true });

  return (
    <main className="flex flex-1 justify-center px-4 py-16">
      <div className="w-full max-w-2xl">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
          Medlemmer
        </h1>
        <p className="mt-2 text-sm text-muted">
          Opprett og se faste medlemmer av Vavik Familietre.
        </p>

        <section className="mt-8 rounded-2xl border border-line bg-surface p-8 shadow-sm">
          <h2 className="font-serif text-lg font-medium tracking-tight text-foreground">
            Eksisterende medlemmer
          </h2>
          <ul className="mt-4 flex flex-col gap-2">
            {(medlemmer ?? []).map((medlem) => (
              <li
                key={medlem.user_id}
                className="flex items-center justify-between rounded-lg border border-line bg-background px-4 py-3 text-sm"
              >
                <span className="text-foreground">
                  {medlem.first_name} {medlem.last_name}{" "}
                  <span className="text-muted">({medlem.email})</span>
                </span>
                <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-medium text-muted">
                  {medlem.role === "admin" ? "Administrator" : "Medlem"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8 rounded-2xl border border-line bg-surface p-8 shadow-sm">
          <h2 className="font-serif text-lg font-medium tracking-tight text-foreground">
            Opprett nytt medlem
          </h2>

          {opprettet === "1" && (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent-hover">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
                <path d="M5.5 10.5L8.5 13.5L14.5 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Medlemmet er opprettet.</span>
            </p>
          )}
          {feil === "mangler-felt" && (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
                <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.6" />
                <path d="M10 6.5V10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="10" cy="13.25" r="0.9" fill="currentColor" />
              </svg>
              <span>Du må fylle ut alle feltene.</span>
            </p>
          )}
          {feil === "opprettelse-feilet" && (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
                <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.6" />
                <path d="M10 6.5V10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="10" cy="13.25" r="0.9" fill="currentColor" />
              </svg>
              <span>Kunne ikke opprette medlemmet. Sjekk at e-posten ikke er i bruk.</span>
            </p>
          )}

          <form action={opprettMedlem} className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium text-foreground">
                E-postadresse
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-foreground placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
            <div className="flex gap-4">
              <div className="flex flex-1 flex-col gap-1.5">
                <label htmlFor="fornavn" className="text-sm font-medium text-foreground">
                  Fornavn
                </label>
                <input
                  id="fornavn"
                  name="fornavn"
                  type="text"
                  required
                  className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-foreground placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <label htmlFor="etternavn" className="text-sm font-medium text-foreground">
                  Etternavn
                </label>
                <input
                  id="etternavn"
                  name="etternavn"
                  type="text"
                  required
                  className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-foreground placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="passord" className="text-sm font-medium text-foreground">
                Passord
              </label>
              <input
                id="passord"
                name="passord"
                type="password"
                required
                autoComplete="new-password"
                className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-foreground placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rolle" className="text-sm font-medium text-foreground">
                Rolle
              </label>
              <select
                id="rolle"
                name="rolle"
                defaultValue="member"
                className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <option value="member">Medlem</option>
                <option value="admin">Administrator</option>
              </select>
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Opprett medlem
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
