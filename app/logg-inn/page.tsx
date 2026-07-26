import { sendMagicLink } from "./actions";

export default async function LoggInnPage({
  searchParams,
}: {
  searchParams: Promise<{ sendt?: string; feil?: string }>;
}) {
  const { sendt, feil } = await searchParams;

  return (
    <main>
      <h1>Logg inn i Vavik Familietre</h1>
      {sendt === "1" && <p>Sjekk innboksen din for en innloggingslenke.</p>}
      {feil === "mangler-epost" && <p>Du må skrive inn en e-postadresse.</p>}
      {feil === "sending-feilet" && (
        <p>Kunne ikke sende innloggingslenke. Prøv igjen.</p>
      )}
      {feil === "lenke-ugyldig" && (
        <p>Innloggingslenken var ugyldig eller utløpt. Prøv å logge inn på nytt.</p>
      )}
      <form action={sendMagicLink}>
        <label htmlFor="email">E-postadresse</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
        <button type="submit">Send innloggingslenke</button>
      </form>
      <p>
        Er du på besøk? <a href="/gjest">Se som gjest</a>
      </p>
    </main>
  );
}
