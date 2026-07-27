"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function opprettMedlem(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/logg-inn");
  }

  // Explicit check required here: this action calls the service-role
  // client below, which bypasses RLS entirely. Unlike the family-code
  // form (which is safe relying on RLS alone via the session-scoped
  // client), skipping this check would let any authenticated or guest
  // caller create arbitrary accounts.
  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (callerProfile?.role !== "admin") {
    redirect("/tre");
  }

  const email = String(formData.get("email") ?? "").trim();
  const fornavn = String(formData.get("fornavn") ?? "").trim();
  const etternavn = String(formData.get("etternavn") ?? "").trim();
  const passord = String(formData.get("passord") ?? "");
  const rolle = formData.get("rolle") === "admin" ? "admin" : "member";

  if (!email || !fornavn || !etternavn || !passord) {
    redirect("/admin/medlemmer?feil=mangler-felt");
  }

  const service = createServiceClient();
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password: passord,
    email_confirm: true,
  });

  if (createError || !created.user) {
    redirect("/admin/medlemmer?feil=opprettelse-feilet");
  }

  const { error: profileError } = await service.from("profiles").insert({
    user_id: created.user.id,
    email,
    first_name: fornavn,
    last_name: etternavn,
    role: rolle,
  });

  if (profileError) {
    redirect("/admin/medlemmer?feil=opprettelse-feilet");
  }

  redirect("/admin/medlemmer?opprettet=1");
}
