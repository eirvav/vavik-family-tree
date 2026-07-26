"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyGuestCode } from "@/lib/guest-code";

export async function bekreftGjestekode(formData: FormData) {
  const kode = String(formData.get("kode") ?? "").trim();

  if (!kode) {
    redirect("/gjest?feil=mangler-kode");
  }

  const service = createServiceClient();
  const { data: settings } = await service
    .from("app_settings")
    .select("guest_code_hash, guest_session_lifetime_days")
    .eq("id", 1)
    .single();

  if (!settings?.guest_code_hash || !verifyGuestCode(kode, settings.guest_code_hash)) {
    redirect("/gjest?feil=feil-kode");
  }

  const supabase = await createClient();
  const {
    data: { user: existingUser },
  } = await supabase.auth.getUser();

  let guestUserId = existingUser?.is_anonymous ? existingUser.id : null;

  if (!guestUserId) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) {
      redirect("/gjest?feil=noe-gikk-galt");
    }
    guestUserId = data.user!.id;
  }

  const { error: rpcError } = await service.rpc("create_guest_session", {
    p_user_id: guestUserId,
    p_lifetime_days: settings.guest_session_lifetime_days,
  });

  if (rpcError) {
    redirect("/gjest?feil=noe-gikk-galt");
  }

  redirect("/tre");
}
