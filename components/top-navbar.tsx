import { TopNavbarClient } from "@/components/top-navbar-client";
import { createClient } from "@/utils/supabase/server";

export async function TopNavbar() {
  let user = null;
  let studyCount: number | null = null;

  try {
    const supabase = await createClient();
    const {
      data: { user: fetchedUser },
    } = await supabase.auth.getUser();
    user = fetchedUser;
    if (fetchedUser) {
      const { count, error: countError } = await supabase
        .from("studies")
        .select("id", { count: "exact", head: true });
      if (!countError && typeof count === "number") {
        studyCount = count;
      }
    }
  } catch (error) {
    console.error(
      "TopNavbar: Failed to fetch navbar metadata from Supabase",
      error,
    );
  }

  const siteTitle =
    process.env.NEXT_PUBLIC_SITE_TITLE?.trim() || "The LOL Report";

  return (
    <TopNavbarClient
      user={user}
      siteTitle={siteTitle}
      studyCount={studyCount}
    />
  );
}
