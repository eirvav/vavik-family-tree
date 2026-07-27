import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loggUt, settFamiliekode } from "./actions";

export default async function TrePage({
  searchParams,
}: {
  searchParams: Promise<{ feil?: string; lagret?: string }>;
}) {
  const { feil, lagret } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/logg-inn");
  }

  const isGuest = Boolean(user.is_anonymous);
  let rolle = "Gjest";
  let isAdmin = false;

  if (!isGuest) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile) {
      redirect("/ikke-tilgang");
    }

    rolle = profile.role === "admin" ? "Administrator" : "Medlem";
    isAdmin = profile.role === "admin";
  }

  return (
    <main className="flex flex-1 justify-center px-4 py-16">
      <div className="w-full max-w-2xl">
        <div className="flex flex-col gap-6 rounded-2xl border border-line bg-surface p-8 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <svg
              width="40"
              height="18"
              viewBox="0 0 48 20"
              fill="none"
              aria-hidden="true"
              className="mt-1 shrink-0 text-gold"
            >
              <path
                d="M24 20V10M24 10C24 10 24 2 16 2M24 10C24 10 24 2 32 2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <div>
              <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
                Velkommen til Vavik Familietre
              </h1>
              <p className="mt-2 inline-flex items-center rounded-full border border-line bg-background px-3 py-1 text-xs font-medium text-muted">
                Innlogget som {rolle}
              </p>
            </div>
          </div>
          <form action={loggUt}>
            <button
              type="submit"
              className="w-full rounded-lg border border-line px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-auto"
            >
              Logg ut
            </button>
          </form>
        </div>

        {isAdmin && (
          <>
            <section className="mt-8 rounded-2xl border border-line bg-surface p-8 shadow-sm">
              <h2 className="font-serif text-lg font-medium tracking-tight text-foreground">
                Sett familiekode
              </h2>
              <p className="mt-1.5 text-sm text-muted">
                Denne koden deler du med familiemedlemmer som skal se treet som gjest.
              </p>

              {lagret === "1" && (
                <p className="mt-4 flex items-start gap-2 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent-hover">
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
                    <path d="M5.5 10.5L8.5 13.5L14.5 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>Familiekoden er lagret.</span>
                </p>
              )}
              {feil === "mangler-kode" && (
                <p className="mt-4 flex items-start gap-2 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
                    <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M10 6.5V10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    <circle cx="10" cy="13.25" r="0.9" fill="currentColor" />
                  </svg>
                  <span>Du må skrive inn en kode.</span>
                </p>
              )}
              {feil === "lagring-feilet" && (
                <p className="mt-4 flex items-start gap-2 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
                    <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M10 6.5V10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    <circle cx="10" cy="13.25" r="0.9" fill="currentColor" />
                  </svg>
                  <span>Kunne ikke lagre koden. Prøv igjen.</span>
                </p>
              )}

              <form action={settFamiliekode} className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="flex flex-1 flex-col gap-1.5">
                  <label htmlFor="kode" className="text-sm font-medium text-foreground">
                    Ny familiekode
                  </label>
                  <input
                    id="kode"
                    name="kode"
                    type="text"
                    required
                    autoComplete="off"
                    className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-foreground placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Lagre
                </button>
              </form>
            </section>

            <a
              href="/admin/medlemmer"
              className="mt-4 inline-block text-sm font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
            >
              Administrer medlemmer
            </a>
          </>
        )}
      </div>
    </main>
  );
}
