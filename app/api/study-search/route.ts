import type { NextRequest } from "next/server";

import {
  buildGlobalStudySearchResponse,
  buildStudySwitcherCatalog,
  fetchFastStudyHubCatalogWithClient,
} from "@/utils/global-attribution-loader";
import { getSupabasePublicEnv } from "@/utils/supabase/env";
import { createClient } from "@/utils/supabase/server";
import {
  isSuperadminProfile,
  SUPERADMIN_REQUIRED_ERROR_MESSAGE,
} from "@/utils/supabase/superadmin";

export async function GET(request: NextRequest) {
  const rawQuery = request.nextUrl.searchParams.get("q") ?? "";
  const isCatalogRequest =
    request.nextUrl.searchParams.get("catalog") === "1";

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    }

    const isSuperadmin = await isSuperadminProfile(supabase, user.id);
    if (!isSuperadmin) {
      return Response.json(
        { error: SUPERADMIN_REQUIRED_ERROR_MESSAGE },
        { status: 403 },
      );
    }

    const { supabaseUrl } = getSupabasePublicEnv();
    const catalog = await fetchFastStudyHubCatalogWithClient(supabase, {
      cacheKey: supabaseUrl,
    });

    if (isCatalogRequest) {
      return Response.json({
        studies: buildStudySwitcherCatalog(catalog),
      });
    }

    const payload = buildGlobalStudySearchResponse(catalog, rawQuery);
    return Response.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to search studies.";
    return Response.json({ error: message }, { status: 500 });
  }
}
