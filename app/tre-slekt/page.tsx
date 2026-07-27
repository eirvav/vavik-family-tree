import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getFamilyTreeData } from "@/lib/family-tree/data";
import { ViewWrapper } from "./view-wrapper";

export default async function TreSlektPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/logg-inn");
  }

  const isGuest = Boolean(user.is_anonymous);
  let canEdit = false;
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

    canEdit = true;
    isAdmin = profile.role === "admin";
  }

  const { people, relationships } = await getFamilyTreeData();

  return (
    <main className="flex h-screen w-full flex-col">
      <ViewWrapper
        people={people}
        relationships={relationships}
        canEdit={canEdit}
        isAdmin={isAdmin}
      />
    </main>
  );
}
