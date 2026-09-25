import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { aiDisabled, withinGlobalBudget } from "@/lib/usage";
import { writerCall } from "@/lib/openai";
import {
  WRITER_RESPONSE_SCHEMA,
  WRITER_SYSTEM_PROMPT,
  buildWriterMessage,
  finalizeWriterOutput,
  normalizeFacts,
  parseWriterOutput,
} from "@/lib/listing-writer";
import { loadWriterContext } from "@/lib/listing-writer-context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isEtsyConfigured } from "@/lib/etsy";
import { findKeywordIdeas } from "@/lib/keyword-finder-server";
import { todayUtc } from "@/lib/listing-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REPAIR =
  "\n\nYour previous answer could not be used. Return ONLY the JSON object with exactly 2 titles, exactly 13 tags, and a description.";

/**
 * Write a new title (2 options), 13 tags, and a description for one linked
 * listing (north star 11.4 F). Paid-only; text-only AI call. The seller copies
 * the result into Etsy themselves: nothing is written to Etsy.
 *
 * Guards: session, active entitlement, per-user rate limit, AI kill switch,
 * global daily AI ceiling, RLS ownership (via the context loader). Every Etsy
 * rule is enforced in code after the model answers (listing-writer.ts).
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");

  const entitlement = await getEntitlement(user.id);
  if (!entitlement.active) {
    return apiError(
      entitlement.reason === "past_due" ? "subscription_past_due" : "subscription_required",
      "Writing listings needs an active subscription."
    );
  }
  if (aiDisabled()) return apiError("ai_disabled", "Writing is paused right now. Try again later.");

  const limit = await rateLimit(`listing-write:u:${user.id}`, 20, 3_600_000);
  if (!limit.ok) return apiError("rate_limited", "You have written a lot this hour. Try again later.");

  let body: { productId?: unknown; facts?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError("bad_request", "Invalid request body.");
  const productId = typeof body.productId === "string" ? body.productId : "";
  if (!UUID_RE.test(productId)) return apiError("bad_request", "Invalid product id.");
  const facts = normalizeFacts(body.facts);
  if (facts === null) return apiError("bad_request", "Facts must be short text.");

  const supabase = await createSupabaseServerClient();
  const ctx = await loadWriterContext(supabase, productId, facts);
  if (!ctx) return apiError("forbidden", "Link your Etsy listing first, then Mavya can write for it.");

  if (!(await withinGlobalBudget("write"))) return apiError("rate_limited", "Mavya is busy right now. Try again in a little while.");

  // Keyword check first (no AI; shared daily cache): lets the writer prefer
  // low-competition phrases and skip crowded or quiet ones. Best effort.
  if (ctx.listingId && isEtsyConfigured()) {
    try {
      ctx.ideas = await findKeywordIdeas(
        createSupabaseAdminClient(),
        { listingId: ctx.listingId, title: ctx.current.title, tags: ctx.current.tags },
        ctx.keywords[0]?.keyword ?? null,
        todayUtc(),
        Date.now() + 25_000
      );
    } catch {
      logEvent("listing.write_keywords_skipped", { userId: user.id });
    }
  }

  const userMessage = buildWriterMessage(ctx);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await writerCall({
        systemPrompt: WRITER_SYSTEM_PROMPT + (attempt ? REPAIR : ""),
        userMessage,
        schema: WRITER_RESPONSE_SCHEMA,
      });
      const result = finalizeWriterOutput(parseWriterOutput(raw), ctx);
      logEvent("listing.write_ok", { userId: user.id, attempt, tags: result.tags.length, placeholders: result.placeholders.length });
      return NextResponse.json({ ok: true, ...result, current: ctx.current });
    } catch (err) {
      logEvent("listing.write_failed", { userId: user.id, attempt, error: err instanceof Error ? err.message.slice(0, 120) : "unknown" });
    }
  }
  return apiError("bad_ai_response", "Mavya could not write this listing right now. Try again.");
}
