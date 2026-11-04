import { resolveAuthOrigin, safeAuthNext } from "@/utils/supabase/auth-origin";
import { NextRequest, NextResponse } from "next/server";

import {
  isSuperadminProfile,
  SUPERADMIN_REQUIRED_ERROR_MESSAGE,
} from "@/utils/supabase/superadmin";
import { createClient } from "@/utils/supabase/server";

const buildLoginRedirect = (origin: string, error: string) => {
  const url = new URL("/login", origin);
  url.searchParams.set("error", error);
  return url;
};

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const redirectOrigin = resolveAuthOrigin(request.headers.get("host") ?? request.nextUrl.host);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");
  const safeNext = safeAuthNext(next, redirectOrigin);

  if (!code) {
    return NextResponse.redirect(
      buildLoginRedirect(redirectOrigin, "Missing auth code."),
    );
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    return NextResponse.redirect(
      buildLoginRedirect(redirectOrigin, exchangeError.message),
    );
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    await supabase.auth.signOut({ scope: "local" });
    return NextResponse.redirect(
      buildLoginRedirect(redirectOrigin, "Unable to fetch authenticated user."),
    );
  }

  const isSuperadmin = await isSuperadminProfile(supabase, user.id);
  if (!isSuperadmin) {
    await supabase.auth.signOut({ scope: "local" });
    return NextResponse.redirect(
      buildLoginRedirect(redirectOrigin, SUPERADMIN_REQUIRED_ERROR_MESSAGE),
    );
  }

  return NextResponse.redirect(new URL(safeNext, redirectOrigin));
}
