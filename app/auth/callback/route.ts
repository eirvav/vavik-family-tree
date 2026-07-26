import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!profile) {
          await supabase.auth.signOut();
          return NextResponse.redirect(`${origin}/ikke-tilgang`);
        }
      }

      return NextResponse.redirect(`${origin}/tre`);
    }
  }

  return NextResponse.redirect(`${origin}/logg-inn?feil=lenke-ugyldig`);
}
