import { sendMagicLink } from "./actions";

export default async function LoggInnPage({
  searchParams,
}: {
  searchParams: Promise<{ sendt?: string; feil?: string }>;
}) {
  const { sendt, feil } = await searchParams;

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
            Skriv inn e-postadressen din, så sender vi deg en innloggingslenke.
          </p>
        </div>

        {sendt === "1" && (
          <p className="mt-6 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent-hover">
            Sjekk innboksen din for en innloggingslenke.
          </p>
        )}
        {feil === "mangler-epost" && (
          <p className="mt-6 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
            Du må skrive inn en e-postadresse.
          </p>
        )}
        {feil === "sending-feilet" && (
          <p className="mt-6 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
            Kunne ikke sende innloggingslenke. Prøv igjen.
          </p>
        )}
        {feil === "lenke-ugyldig" && (
          <p className="mt-6 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
            Innloggingslenken var ugyldig eller utløpt. Prøv å logge inn på nytt.
          </p>
        )}

        <form action={sendMagicLink} className="mt-6 flex flex-col gap-4">
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
          <button
            type="submit"
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Send innloggingslenke
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
