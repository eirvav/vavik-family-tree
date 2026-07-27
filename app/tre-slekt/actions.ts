"use server";

import { createClient } from "@/lib/supabase/server";

export async function savePersonPosition(personId: string, x: number, y: number) {
  const supabase = await createClient();

  // Relies entirely on the canvas_positions RLS policies (member/admin only
  // for insert/update) to reject this for guests or unauthenticated callers
  // — same pattern as the existing "sett familiekode" action, safe because
  // this uses the session-scoped client end to end, never the service role.
  const { error } = await supabase
    .from("canvas_positions")
    .upsert({ person_id: personId, x, y, updated_at: new Date().toISOString() });

  return { error: error?.message ?? null };
}

export async function resetLayout() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Ikke innlogget" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  // Explicit check required here, same reasoning as the admin member-dashboard
  // action: resetting the SHARED layout for the whole family is a broader
  // action than a single row upsert, so don't rely on RLS's per-row check alone
  // to communicate "only an admin should trigger a full reset."
  if (profile?.role !== "admin") {
    return { error: "Kun administrator kan tilbakestille oppsettet" };
  }

  const { error } = await supabase.from("canvas_positions").delete().neq("person_id", "00000000-0000-0000-0000-000000000000");

  return { error: error?.message ?? null };
}
