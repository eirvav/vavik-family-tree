export default function IkkeTilgangPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-sm sm:p-10">
        <svg
          width="48"
          height="20"
          viewBox="0 0 48 20"
          fill="none"
          aria-hidden="true"
          className="mx-auto text-gold"
        >
          <path
            d="M24 20V10M24 10C24 10 24 2 16 2M24 10C24 10 24 2 32 2"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <h1 className="mt-4 font-serif text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
          Du har ikke tilgang
        </h1>
        <p className="mt-3 text-sm text-muted">
          Denne kontoen er ikke godkjent for Vavik Familietre. Ta kontakt med en
          administrator hvis du mener dette er feil.
        </p>
        <p className="mt-8 border-t border-line pt-6">
          <a
            href="/logg-inn"
            className="text-sm font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
          >
            Tilbake til innlogging
          </a>
        </p>
      </div>
    </main>
  );
}
