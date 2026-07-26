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
    <main>
      <h1>Velkommen til Vavik Familietre</h1>
      <p>Du er innlogget som: {rolle}</p>
      <form action={loggUt}>
        <button type="submit">Logg ut</button>
      </form>

      {isAdmin && (
        <section>
          <h2>Sett familiekode</h2>
          <p>Denne koden deler du med familiemedlemmer som skal se treet som gjest.</p>
          {lagret === "1" && <p>Familiekoden er lagret.</p>}
          {feil === "mangler-kode" && <p>Du må skrive inn en kode.</p>}
          {feil === "lagring-feilet" && <p>Kunne ikke lagre koden. Prøv igjen.</p>}
          <form action={settFamiliekode}>
            <label htmlFor="kode">Ny familiekode</label>
            <input id="kode" name="kode" type="text" required autoComplete="off" />
            <button type="submit">Lagre</button>
          </form>
        </section>
      )}
    </main>
  );
}
