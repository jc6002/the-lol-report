import { notFound, redirect } from "next/navigation";

import { parsePositiveStudyId } from "@/utils/attribution-ui-helpers";

type StudyIndexPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function StudyIndexPage({
  params,
  searchParams,
}: StudyIndexPageProps) {
  const { id } = await params;
  const studyId = parsePositiveStudyId(id);
  if (studyId === null) {
    notFound();
  }

  const query = searchParams ? await searchParams : {};
  const qs = new URLSearchParams();
  for (const [key, val] of Object.entries(query)) {
    if (typeof val === "string") {
      qs.set(key, val);
    } else if (Array.isArray(val) && val[0] !== undefined) {
      qs.set(key, val[0]);
    }
  }
  const suffix = qs.toString();
  redirect(
    suffix
      ? `/study/${studyId}/attribution?${suffix}`
      : `/study/${studyId}/attribution`,
  );
}
