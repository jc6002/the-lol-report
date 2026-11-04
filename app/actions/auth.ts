"use server";

import { resolveAuthOrigin } from "@/utils/supabase/auth-origin";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getMissingAuthEnvVars } from "@/utils/supabase/env";
import { createClient } from "@/utils/supabase/server";

const getOrigin = async () => {
  const headersList = await headers();
  return resolveAuthOrigin(headersList.get("host"));
};

export const signInWithGoogleAction = async () => {
  const missingEnvVars = getMissingAuthEnvVars();
  if (missingEnvVars.length > 0) {
    redirect(
      `/login?error=${encodeURIComponent(
        `Missing env vars: ${missingEnvVars.join(", ")}`,
      )}`,
    );
  }

  const supabase = await createClient();
  const origin = await getOrigin();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      skipBrowserRedirect: true,
      queryParams: {
        prompt: "select_account",
      },
    },
  });

  if (error || !data.url) {
    const message = error?.message ?? "Unable to start Google sign in.";
    redirect(`/login?error=${encodeURIComponent(message)}`);
  }

  redirect(data.url);
};

export const signOutAction = async () => {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
};
