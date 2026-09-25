import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchEtsyImage, type EtsyImage } from "@/lib/etsy";
import { logEvent } from "@/lib/errors";
import { MAX_SUPPORTING_PHOTOS } from "@/lib/versions";

/**
 * Import a listing's SUPPORTING photos from Etsy without scoring them. SERVER
 * ONLY, service-role client, caller has already verified ownership.
 *
 * Each photo is stored like an upload but gets NO rating job: the seller
 * decides which ones to score (POST /api/photos/score). The storage file name
 * carries the `etsy-` marker, which is how the product page tells "imported,
 * not scored yet" apart from "upload still being rated".
 *
 * Photo ids are derived from (product, Etsy image id), so a repeated or
 * concurrent import of the same image fails on the primary key instead of
 * creating a duplicate.
 */

export const ETSY_IMPORT_MARKER = "/etsy-";

export function isUnscoredEtsyImport(p: { role: string; storage_path: string; hasAudit: boolean; hasRatingJob: boolean }): boolean {
  return p.role === "supporting" && !p.hasAudit && !p.hasRatingJob && p.storage_path.includes(ETSY_IMPORT_MARKER);
}

export function importedPhotoId(productId: string, etsyImageId: number): string {
  const h = createHash("sha256").update(`${productId}:etsy-image:${etsyImageId}`).digest("hex");
  // Shape as an RFC 4122 v4-style UUID (version 4, variant 8-b).
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${"89ab"[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function toJpeg(image: EtsyImage): Promise<Buffer> {
  const src = image.urlFull ?? image.url570;
  if (!src) throw new Error("no image url");
  let fetched;
  try {
    fetched = await fetchEtsyImage(src);
  } catch {
    if (!image.url570 || image.url570 === src) throw new Error("image fetch failed");
    fetched = await fetchEtsyImage(image.url570);
  }
  return sharp(fetched.buffer).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
}

/** Returns how many supporting photos were newly imported. Never throws. */
export async function importEtsySupportingPhotos(
  admin: SupabaseClient,
  userId: string,
  productId: string,
  images: EtsyImage[]
): Promise<number> {
  const { data: existing, error } = await admin
    .from("photos")
    .select("id")
    .eq("product_id", productId)
    .eq("role", "supporting");
  if (error) return 0;
  const have = new Set((existing ?? []).map((r) => r.id as string));
  const room = MAX_SUPPORTING_PHOTOS - have.size;
  if (room <= 0) return 0;
  const todo = images
    .slice(1)
    .map((image, i) => ({ image, position: i + 1, id: importedPhotoId(productId, image.id) }))
    .filter((t) => !have.has(t.id))
    .slice(0, room);

  const results = await Promise.all(
    todo.map(async ({ image, position, id }) => {
      const storagePath = `${userId}/${productId}${ETSY_IMPORT_MARKER}${id}.jpg`;
      try {
        const jpeg = await toJpeg(image);
        const { error: uploadError } = await admin.storage
          .from("product-photos")
          .upload(storagePath, jpeg, { contentType: "image/jpeg", upsert: false });
        if (uploadError) throw uploadError;
        const { error: insertError } = await admin.from("photos").insert({
          id,
          product_id: productId,
          role: "supporting",
          storage_path: storagePath,
          mime: "image/jpeg",
          position,
        });
        if (insertError) {
          await admin.storage.from("product-photos").remove([storagePath]);
          throw insertError;
        }
        return 1;
      } catch {
        logEvent("shop.import_supporting_failed", { userId });
        return 0;
      }
    })
  );
  return results.reduce<number>((a, b) => a + b, 0);
}
