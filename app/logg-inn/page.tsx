import { loggInnMedPassord } from "./actions";

export default async function LoggInnPage({
  searchParams,
}: {
  searchParams: Promise<{ feil?: string }>;
}) {
  const { feil } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 shadow-sm sm:p-10">
        <div className="flex flex-col items-center text-center">
          <svg
            width="48"
            height="20"
            viewBox="0 0 48 20"
            fill="none"
            aria-hidden="true"
            className="text-gold"
          >
            <path
              d="M24 20V10M24 10C24 10 24 2 16 2M24 10C24 10 24 2 32 2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <h1 className="mt-4 font-serif text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
            Logg inn i Vavik Familietre
          </h1>
          <p className="mt-2 text-sm text-muted">
            Skriv inn e-postadressen og passordet ditt.
          </p>
        </div>

        {feil === "mangler-felt" && (
          <p className="mt-6 flex items-start gap-2 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
              <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.6" />
              <path d="M10 6.5V10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="10" cy="13.25" r="0.9" fill="currentColor" />
            </svg>
            <span>Du må fylle ut både e-post og passord.</span>
          </p>
        )}
        {feil === "feil-innlogging" && (
          <p className="mt-6 flex items-start gap-2 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
              <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.6" />
              <path d="M10 6.5V10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="10" cy="13.25" r="0.9" fill="currentColor" />
            </svg>
            <span>Feil e-post eller passord.</span>
          </p>
        )}

        <form action={loggInnMedPassord} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium text-foreground">
              E-postadresse
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-foreground placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
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
              autoComplete="current-password"
              className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-foreground placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Logg inn
          </button>
        </form>

        <p className="mt-8 border-t border-line pt-6 text-center text-sm text-muted">
          Er du på besøk?{" "}
          <a href="/gjest" className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover">
            Se som gjest
          </a>
        </p>
      </div>
    </main>
  );
}
