/**
 * ONE-OFF evidence audit (Codex step 1 + 7) for scoring contradictions across
 * ALL products (main + supporting photos). Read-only against the database
 * (raw PostgREST, no supabase-js so it runs on Node 20); makes bounded live
 * provider calls for the repeatability check.
 *
 * Run: RUN_SCORE_AUDIT=true npx vitest run eval/audit-candle-pair.test.ts
 */
import { describe, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function loadLocalEnv(): void {
  const envPath = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadLocalEnv();

const RUN = process.env.RUN_SCORE_AUDIT === "true";
const REPEATS = Number(process.env.AUDIT_REPEATS || 2);

type AnyRow = Record<string, unknown>;

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function rest<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${BASE}/rest/v1/${pathAndQuery}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`${pathAndQuery} -> ${res.status}`);
  return (await res.json()) as T;
}

async function download(storagePath: string): Promise<Buffer> {
  const res = await fetch(`${BASE}/storage/v1/object/product-photos/${storagePath}`, {
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`download ${storagePath} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const PROVENANCE_WORDS = /ai-looking|mockup|pasted|cutout|floating|fake/i;

function pillarLine(rubric: AnyRow | null | undefined): string {
  if (!rubric) return "(none)";
  const p = (rubric.pillars ?? {}) as Record<string, number>;
  const pills = Object.keys(p)
    .map((k) => `${k}=${p[k]}`)
    .join(" ");
  const overall = Number(rubric.overall_score);
  const band = overall >= 8 ? "STRONG" : overall >= 6 ? "mid" : "weak";
  const prose = `${rubric.priority_action} ${rubric.priority_explanation} ${JSON.stringify(
    rubric.next_steps ?? ""
  )}`;
  return (
    `overall=${rubric.overall_score} raw=${rubric.raw_overall_score} band=${band} ${pills} ` +
    `trust=${rubric.trust_risk ?? "(absent)"} evidence="${rubric.trust_evidence ?? ""}" ` +
    `provenance_wording=${PROVENANCE_WORDS.test(prose)}`
  );
}

describe.skipIf(!RUN)("all-products score audit", () => {
  it(
    "dumps stored rubrics and measures rescoring variance",
    { timeout: 1_800_000 },
    async () => {
      const products = await rest<AnyRow[]>(
        "products?select=id,name&order=created_at.asc"
      );
      const { scorePhoto } = await import("@/lib/score-photo");
      const { GENERAL_RUBRIC_PROMPT } = await import("@/lib/general-rubric");

      for (const product of products) {
        console.log(`\n\n################ PRODUCT ${product.name ?? product.id} ################`);
        const photos = await rest<AnyRow[]>(
          `photos?select=id,role,storage_path,mime,selected_generation_job_id&product_id=eq.${product.id}&order=role.asc`
        );
        let mainContext: string | undefined;

        for (const photo of photos) {
          // Optional focus: score only one photo id (fast targeted validation).
          if (process.env.AUDIT_PHOTO && photo.id !== process.env.AUDIT_PHOTO) {
            continue;
          }
          const audits = await rest<AnyRow[]>(
            `audits?select=id,rubric,created_at&photo_id=eq.${photo.id}&order=created_at.desc&limit=1`
          );
          const audit = audits[0];
          const rub = (audit?.rubric ?? null) as AnyRow | null;
          if (photo.role === "main") {
            mainContext = (rub?.product_summary as string) || undefined;
          }

          console.log(`\n--- PHOTO ${photo.id} role=${photo.role} ---`);
          console.log("STORED audit:", pillarLine(rub));
          if (rub) console.log("  priority_action:", rub.priority_action);

          const jobs = await rest<AnyRow[]>(
            `generation_jobs?select=id,status,operation,attempt_number,raw_score,calibrated_score,outcome,candidate_rubric,fidelity,result_storage_path,created_at&photo_id=eq.${photo.id}&order=created_at.asc`
          );
          for (const j of jobs) {
            console.log(
              `  job op=${j.operation} a${j.attempt_number} ${j.status} raw(col)=${j.raw_score} ` +
                `outcome=${j.outcome} selected=${photo.selected_generation_job_id === j.id}`
            );
            if (j.candidate_rubric) {
              console.log("    candidate:", pillarLine(j.candidate_rubric as AnyRow));
              console.log(
                "    priority_action:",
                (j.candidate_rubric as AnyRow).priority_action
              );
            }
            const f = j.fidelity as AnyRow | null;
            if (f) {
              console.log(
                `    fidelity: publishable=${f.publishable} ai_looking=${f.ai_looking} ` +
                  `invented=${f.invented_or_missing_details} drift=${f.text_or_pattern_drift} ` +
                  `full_visible=${f.full_product_visible} fid=${f.fidelity_score} auth=${f.authenticity_score}`
              );
              console.log("    fidelity reason:", f.reason);
            }
          }

          // Repeatability: original + selected result, REPEATS runs each.
          const selected = jobs.find((j) => j.id === photo.selected_generation_job_id);
          const targets: { label: string; path: string; mime: string }[] = [];
          if (photo.storage_path) {
            targets.push({
              label: "ORIGINAL",
              path: photo.storage_path as string,
              mime: photo.mime === "image/png" ? "image/png" : "image/jpeg",
            });
          }
          if (selected?.result_storage_path) {
            targets.push({
              label: "IMPROVED(selected)",
              path: selected.result_storage_path as string,
              mime: "image/png",
            });
          }
          const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
          for (const t of targets) {
            const buf = await download(t.path);
            for (let i = 1; i <= REPEATS; i++) {
              // 30k TPM org limit; each scoring call is ~10k tokens.
              await sleep(21_000);
              for (let attempt = 0; attempt < 2; attempt++) {
                try {
                  const r = (await scorePhoto({
                    imageBuffer: buf,
                    imageMimeType: t.mime,
                    systemPrompt:
                      photo.role === "supporting" ? GENERAL_RUBRIC_PROMPT : undefined,
                    mainProductContext:
                      photo.role === "supporting" ? mainContext : undefined,
                    buyerQuestions: { kind: "none" },
                  })) as unknown as AnyRow;
                  console.log(`  RESCORE ${t.label} run ${i}: ${pillarLine(r)}`);
                  console.log(`     priority_action: ${r.priority_action}`);
                  break;
                } catch (err) {
                  if (attempt === 1) {
                    console.log(
                      `  RESCORE ${t.label} run ${i}: failed (${err instanceof Error ? err.message : err})`
                    );
                  } else {
                    await sleep(30_000);
                  }
                }
              }
            }
          }
        }
      }
    }
  );
});
