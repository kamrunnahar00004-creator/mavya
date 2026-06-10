/**
 * Server-only blob storage for the paywall.
 *
 * HARD INVARIANT: the clean full-resolution improved image is stored here and
 * NEVER returned to the browser before payment. The browser only ever sees a
 * watermarked, downscaled preview (see `createWatermarkedPreview`). The clean
 * blob URL is never sent to the client; `/api/download` streams the bytes after
 * verifying a paid Stripe session.
 *
 * No database: the file lives in blob storage keyed by an unguessable assetId,
 * and a sibling meta.json records provenance (outcome + scores + createdAt).
 */

import { put, list } from "@vercel/blob";
import sharp from "sharp";

export type AssetMeta = {
  assetId: string;
  outcome: "publish_ready" | "useful_free_preview";
  scoreBefore: number;
  scoreAfter: number;
  createdAt: number;
  mimeType: "image/png";
};

const ROOT = "mavya-assets";

function fullPath(assetId: string): string {
  return `${ROOT}/${assetId}/full.png`;
}

function metaPath(assetId: string): string {
  return `${ROOT}/${assetId}/meta.json`;
}

export function createAssetId(): string {
  return crypto.randomUUID();
}

/** UUID v4 shape guard for untrusted client input. */
export function isAssetId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function token(): string {
  const t = process.env.BLOB_READ_WRITE_TOKEN;
  if (!t) {
    throw new Error("BLOB_READ_WRITE_TOKEN not set.");
  }
  return t;
}

/**
 * Store the clean full-resolution PNG. `addRandomSuffix: false` keeps the path
 * deterministic for `/api/download`; the assetId segment is the unguessable key.
 */
export async function putCleanImage(
  assetId: string,
  buffer: Buffer
): Promise<void> {
  await put(fullPath(assetId), buffer, {
    access: "public",
    contentType: "image/png",
    addRandomSuffix: false,
    token: token(),
    cacheControlMaxAge: 0,
  });
}

export async function putMeta(meta: AssetMeta): Promise<void> {
  await put(metaPath(meta.assetId), JSON.stringify(meta), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    token: token(),
    cacheControlMaxAge: 0,
  });
}

// Resolve a blob's downloadable URL from its pathname without storing it (no DB).
// `list` with the asset prefix returns the current URLs for that asset's files.
async function blobUrl(path: string): Promise<string | null> {
  try {
    const prefix = path.slice(0, path.lastIndexOf("/") + 1);
    const { blobs } = await list({ prefix, token: token() });
    return blobs.find((b) => b.pathname === path)?.url ?? null;
  } catch {
    return null;
  }
}

export async function getMeta(assetId: string): Promise<AssetMeta | null> {
  const url = await blobUrl(metaPath(assetId));
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as AssetMeta;
    if (
      json.assetId !== assetId ||
      !["publish_ready", "useful_free_preview"].includes(json.outcome)
    ) {
      return null;
    }
    return json;
  } catch {
    return null;
  }
}

export async function getCleanImage(assetId: string): Promise<Buffer | null> {
  const url = await blobUrl(fullPath(assetId));
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

/**
 * Build a watermarked, downscaled preview from the EXACT final clean image.
 * Downscale to 640px max dimension + tiled diagonal "Mavya preview" so the
 * result proves quality but is unusable as a real listing image. Returns base64
 * (no data-URL prefix).
 */
export async function createWatermarkedPreview(clean: Buffer): Promise<string> {
  // Resize to a concrete buffer FIRST, then measure it. sharp's metadata()
  // reflects the SOURCE image, not pending resize ops — so the watermark SVG
  // must be sized to the resized buffer, or the composite fails.
  const resized = await sharp(clean)
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  const meta = await sharp(resized).metadata();
  const w = meta.width ?? 640;
  const h = meta.height ?? 640;

  // Tiled diagonal watermark text as an SVG overlay.
  const tile = 220;
  const marks: string[] = [];
  for (let y = -tile; y < h + tile; y += tile) {
    for (let x = -tile; x < w + tile; x += tile) {
      marks.push(
        `<text x="${x}" y="${y}" transform="rotate(-30 ${x} ${y})" font-family="sans-serif" font-size="22" font-weight="700" fill="rgba(255,255,255,0.45)" stroke="rgba(25,23,20,0.18)" stroke-width="0.5">Mavya preview</text>`
      );
    }
  }
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${marks.join(
    ""
  )}</svg>`;

  const out = await sharp(resized)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
  return out.toString("base64");
}
