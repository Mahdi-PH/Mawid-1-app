"use client";

// License images are stored as a compressed base64 data: URL directly on
// the clinics/{slug} document, not in Firebase Storage. This was a real
// pivot, not the original plan: Firebase changed policy so that enabling
// Cloud Storage for Firebase on a project now requires the Blaze
// (pay-as-you-go) plan even for free-tier usage — confirmed by a 403
// "Cloud Storage for Firebase API has not been used" error that persisted
// after the user enabled Storage in console, then again after waiting for
// propagation. Rather than ask the user to attach billing just to store a
// handful of review images, this stores them inline in Firestore instead
// — exactly what the demo artifact already does with FileReader +
// localStorage, so both tracks now agree. The tradeoff: a Firestore
// document is capped at 1 MiB total, so the image is downscaled and
// re-encoded client-side first (see MAX_DATA_URL_BYTES below and
// firestore.rules' size cap on licenseImageUrl, which enforces the same
// limit server-side).
const MAX_DIMENSION = 1000;
const JPEG_QUALITY = 0.7;
const MAX_DATA_URL_BYTES = 900_000; // headroom under Firestore's 1 MiB doc cap

export class LicenseImageTooLargeError extends Error {
  constructor() {
    super("الصورة كبيرة جداً حتى بعد الضغط — جرّب صورة أوضح أو أصغر حجماً.");
    this.name = "LicenseImageTooLargeError";
  }
}

export async function compressLicenseImageToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  if (dataUrl.length > MAX_DATA_URL_BYTES) throw new LicenseImageTooLargeError();
  return dataUrl;
}
