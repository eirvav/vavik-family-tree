"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hashGuestCode } from "@/lib/guest-code";

export async function loggUt() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/logg-inn");
}

export async function settFamiliekode(formData: FormData) {
  const kode = String(formData.get("kode") ?? "").trim();

  if (!kode) {
    redirect("/tre?feil=mangler-kode");
  }

  const supabase = await createClient();
  const hash = hashGuestCode(kode);

  // Relies entirely on the app_settings_admin_all RLS policy (Task 5) to
  // reject this for non-admins — there is no separate role check here.
  const { error } = await supabase
    .from("app_settings")
    .update({ guest_code_hash: hash, updated_at: new Date().toISOString() })
    .eq("id", 1);

  if (error) {
    redirect("/tre?feil=lagring-feilet");
  }

  redirect("/tre?lagret=1");
}
