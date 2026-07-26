import { bekreftGjestekode } from "./actions";

export default async function GjestPage({
  searchParams,
}: {
  searchParams: Promise<{ feil?: string }>;
}) {
  const { feil } = await searchParams;

  return (
    <main>
      <h1>Se Vavik Familietre som gjest</h1>
      <p>Skriv inn familiekoden du har fått av en administrator.</p>
      {feil === "mangler-kode" && <p>Du må skrive inn en kode.</p>}
      {feil === "feil-kode" && <p>Feil kode. Prøv igjen.</p>}
      {feil === "noe-gikk-galt" && <p>Noe gikk galt. Prøv igjen.</p>}
      <form action={bekreftGjestekode}>
        <label htmlFor="kode">Familiekode</label>
        <input id="kode" name="kode" type="text" required autoComplete="off" />
        <button type="submit">Fortsett</button>
      </form>
      <p>
        Er du et fast medlem av familien? <a href="/logg-inn">Logg inn</a>
      </p>
    </main>
  );
}
