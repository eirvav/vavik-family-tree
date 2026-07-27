"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function loggInnMedPassord(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const passord = String(formData.get("passord") ?? "");

  if (!email || !passord) {
    redirect("/logg-inn?feil=mangler-felt");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: passord,
  });

  if (error || !data.user) {
    redirect("/logg-inn?feil=feil-innlogging");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (!profile) {
    await supabase.auth.signOut();
    redirect("/ikke-tilgang");
  }

  redirect("/tre");
}
