import { redirect } from "next/navigation";
import { researchHref } from "@/lib/research";

/** Old address of Keyword Research (before the Research section). */
export default async function OldKeywordResearchPage({ searchParams }: { searchParams: Promise<{ q?: string; valid?: string }> }) {
  const { q, valid } = await searchParams;
  redirect(researchHref("keyword", { q: q?.slice(0, 200), valid: valid === "1" ? 1 : null }));
}
