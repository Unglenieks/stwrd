// Client-side image pipeline (spec §8.2, §18.2).
//
// Downscale to photoMaxEdgePx and re-encode to WebP before upload. Re-encoding
// through a canvas STRIPS all EXIF/GPS metadata (the server then verifies, §18.1)
// and the quality search keeps each photo around the target size.
import { PHOTO_MAX_EDGE_PX_DEFAULT, PHOTO_TARGET_BYTES } from "@stwrd/shared";

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("could not read image"));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/webp", quality));
}

/**
 * Downscale + re-encode a user-selected image to a metadata-free WebP ≤ ~target.
 * Returns the processed Blob (type image/webp).
 */
export async function processImage(
  file: File,
  maxEdge = PHOTO_MAX_EDGE_PX_DEFAULT,
  targetBytes = PHOTO_TARGET_BYTES,
): Promise<Blob> {
  const img = await loadImage(file);
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(img, 0, 0, w, h);

  // Step quality down until under target (or we hit the floor).
  let quality = 0.9;
  let blob = await canvasToBlob(canvas, quality);
  while (blob && blob.size > targetBytes && quality > 0.4) {
    quality -= 0.1;
    blob = await canvasToBlob(canvas, quality);
  }
  if (!blob) throw new Error("image encoding failed");
  return blob;
}

/** POST a processed blob to a Convex upload URL; returns the storage id. */
export async function uploadToConvex(uploadUrl: string, blob: Blob): Promise<string> {
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": blob.type },
    body: blob,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  const { storageId } = (await res.json()) as { storageId: string };
  return storageId;
}
