// Encode/decode for the "Universal Patient Passport" QR payload — plain
// JSON, base64-encoded only to keep the QR's own data denser/more
// scan-reliable than raw JSON with braces/quotes, NOT for secrecy. The
// actual security is the requestId's randomness + short expiresAt window,
// both enforced server-side by firestore.rules (see access_requests
// there) — this file is just the shared wire format so /find/passport
// (generates it) and /clinic's scanner tab (decodes it) can't drift.
export const ACCESS_REQUEST_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface QrPassportPayload {
  /** Always the literal string below — lets the scanner reject a QR code
   *  from something else entirely (e.g. a different app) with a clear
   *  message instead of a confusing crash on missing fields. */
  kind: "mawid_patient_passport";
  patientId: string;
  requestId: string;
  /** Epoch ms — matches the access_requests/{requestId} doc's own
   *  expiresAt, duplicated into the QR so the scanner can reject an
   *  obviously-stale code instantly, before even reading Firestore. */
  exp: number;
}

export function encodeQrPayload(payload: QrPassportPayload): string {
  return btoa(encodeURIComponent(JSON.stringify(payload)));
}

export class InvalidQrPayloadError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidQrPayloadError";
  }
}

export function decodeQrPayload(raw: string): QrPassportPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(atob(raw.trim())));
  } catch {
    throw new InvalidQrPayloadError("هذا الرمز غير قابل للقراءة.");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as Record<string, unknown>).kind !== "mawid_patient_passport" ||
    typeof (parsed as Record<string, unknown>).patientId !== "string" ||
    typeof (parsed as Record<string, unknown>).requestId !== "string" ||
    typeof (parsed as Record<string, unknown>).exp !== "number"
  ) {
    throw new InvalidQrPayloadError("هذا الرمز ليس بطاقة مراجع صالحة لتطبيق موعد.");
  }
  const payload = parsed as QrPassportPayload;
  if (payload.exp < Date.now()) {
    throw new InvalidQrPayloadError("انتهت صلاحية هذا الرمز — اطلب من المراجع إظهار رمز جديد.");
  }
  return payload;
}
