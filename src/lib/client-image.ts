"use client";

import {
  CLIENT_IMAGE_MAX_EDGE,
  CLIENT_IMAGE_MIN_QUALITY,
  CLIENT_IMAGE_START_QUALITY,
  CLIENT_IMAGE_TARGET_BYTES,
} from "@/lib/upload-limits";

const OUTPUT_TYPE = "image/jpeg";

export async function prepareUploadImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  // The server only accepts JPEG/PNG. Anything else (webp, gif, bmp, etc.) must be
  // re-encoded to JPEG client-side via the canvas pipeline, even when the original
  // is already small, otherwise it reaches the server and is rejected as bad_mime.
  const isServerReadyType =
    file.type === "image/jpeg" || file.type === "image/png";

  try {
    const blob = await drawCompressed(file);
    if (
      isServerReadyType &&
      blob.size >= file.size &&
      file.size <= CLIENT_IMAGE_TARGET_BYTES
    ) {
      return file;
    }
    const name = file.name.replace(/\.[^.]+$/, "") || "mavya-photo";
    return new File([blob], `${name}.jpg`, {
      type: OUTPUT_TYPE,
      lastModified: Date.now(),
    });
  } catch (err) {
    console.warn("[client-image] compression failed, using original", err);
    return file;
  }
}

export async function compressDataUrlForUpload(dataUrl: string): Promise<string> {
  try {
    const blob = await fetch(dataUrl).then((res) => res.blob());
    const compressed = await drawCompressed(blob);
    return await blobToDataUrl(compressed);
  } catch (err) {
    console.warn("[client-image] data URL compression failed, using original", err);
    return dataUrl;
  }
}

async function drawCompressed(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(
      1,
      CLIENT_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height)
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    let quality = CLIENT_IMAGE_START_QUALITY;
    let best = await canvasToBlob(canvas, quality);
    while (
      best.size > CLIENT_IMAGE_TARGET_BYTES &&
      quality > CLIENT_IMAGE_MIN_QUALITY
    ) {
      quality = Math.max(CLIENT_IMAGE_MIN_QUALITY, quality - 0.08);
      best = await canvasToBlob(canvas, quality);
    }
    return best;
  } finally {
    bitmap.close();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode image."));
      },
      OUTPUT_TYPE,
      quality
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Could not read image."));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image."));
    reader.readAsDataURL(blob);
  });
}
