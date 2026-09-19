"use client";

// Firestore helpers for the "Universal Patient Passport" QR-code medical
// archive. Three collections, all covered by matching firestore.rules:
//   - patient_records/{patientId}            — one profile per patient
//   - patient_records/{patientId}/entries/{}  — immutable history/prescription entries
//   - access_requests/{requestId}             — the QR's own short-lived claim ticket
//   - access_grants/{patientId}_{clinicOwnerUid} — the actual time-boxed permission
//
// See types.ts for the full design rationale (why Patient_ID is the
// existing anonymous-auth uid, why entries are a subcollection rather than
// an array, why access_requests exists separately from access_grants).
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./config";
import { ACCESS_REQUEST_TTL_MS } from "../qrPassport";
import type {
  AccessGrantDoc,
  AccessRequestDoc,
  PatientRecordDoc,
  RecordEntryDoc,
  RecordEntryType,
} from "./types";

/** How long an approved grant lasts once the patient taps "موافقة" — a
 *  fixed period standing in for "the duration of the consultation" (this
 *  app has no way to know when a real consultation actually ends). */
export const ACCESS_GRANT_MINUTES = 30;

export class AccessRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessRequestError";
  }
}

function grantId(patientId: string, clinicOwnerUid: string): string {
  return `${patientId}_${clinicOwnerUid}`;
}

// ---------------------------------------------------------------------
// patient_records/{patientId} + entries/
// ---------------------------------------------------------------------

export async function getPatientRecord(patientId: string): Promise<PatientRecordDoc | null> {
  const snap = await getDoc(doc(db, "patient_records", patientId));
  return snap.exists() ? (snap.data() as PatientRecordDoc) : null;
}

/** Creates the patient's own record doc on first use of the passport
 *  screen; a no-op (just re-reads) if one already exists — safe to call
 *  on every /find/passport visit. */
export async function getOrCreatePatientRecord(patientId: string, fullName: string): Promise<PatientRecordDoc> {
  const existing = await getPatientRecord(patientId);
  if (existing) return existing;
  const data: Omit<PatientRecordDoc, "createdAt" | "updatedAt"> & { createdAt: unknown; updatedAt: unknown } = {
    patientId,
    fullName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, "patient_records", patientId), data);
  return (await getPatientRecord(patientId))!;
}

/** No orderBy — same reasoning as every other list function in this
 *  track (listAppointmentsForPatient, adminListPendingClinics, etc.):
 *  avoids needing a composite index the service account can't deploy
 *  anyway; a single patient's own entry count is small, sort client-side. */
export async function listRecordEntries(patientId: string): Promise<RecordEntryDoc[]> {
  const snap = await getDocs(collection(db, "patient_records", patientId, "entries"));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as RecordEntryDoc)
    .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
}

/** Live updates for whichever screen (patient's own passport, or a
 *  clinic mid-consultation) is currently viewing the entry list — new
 *  prescriptions/reports show up without a manual refresh. */
export function watchRecordEntries(patientId: string, onChange: (entries: RecordEntryDoc[]) => void): () => void {
  return onSnapshot(
    collection(db, "patient_records", patientId, "entries"),
    (snap) => {
      const entries = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as RecordEntryDoc)
        .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
      onChange(entries);
    },
    () => onChange([])
  );
}

/** A patient adding their own self-reported note — always allowed on
 *  their own record, no grant needed. */
export async function addRecordEntrySelf(patientId: string, type: RecordEntryType, text: string): Promise<void> {
  const ref = doc(collection(db, "patient_records", patientId, "entries"));
  const data: Omit<RecordEntryDoc, "id" | "createdAt"> & { createdAt: unknown } = {
    type,
    text,
    authorType: "patient",
    clinicOwnerUid: null,
    clinicSlug: null,
    clinicName: null,
    createdAt: serverTimestamp(),
  };
  await setDoc(ref, data);
}

/** A clinic appending a new prescription/report while it holds an active
 *  grant — firestore.rules independently re-checks that grant exists
 *  before allowing this write; a lapsed/never-existing grant is rejected
 *  server-side even if this function is called directly. */
export async function addRecordEntryByClinic(
  patientId: string,
  clinic: { ownerUid: string; slug: string; clinicName: string },
  type: RecordEntryType,
  text: string
): Promise<void> {
  const ref = doc(collection(db, "patient_records", patientId, "entries"));
  const data: Omit<RecordEntryDoc, "id" | "createdAt"> & { createdAt: unknown } = {
    type,
    text,
    authorType: "clinic",
    clinicOwnerUid: clinic.ownerUid,
    clinicSlug: clinic.slug,
    clinicName: clinic.clinicName,
    createdAt: serverTimestamp(),
  };
  await setDoc(ref, data);
}

// ---------------------------------------------------------------------
// access_requests/{requestId} — the QR's own short-lived claim ticket
// ---------------------------------------------------------------------

/** Called when the patient taps "إظهار رمز الدخول" on /find/passport —
 *  mints a fresh, random-id request doc and returns everything needed to
 *  render + encode the QR. A brand-new id every time (rather than one
 *  reused request per patient) means an old, already-shown QR image can
 *  never be replayed after a new one is generated, on top of its own
 *  expiresAt window. */
export async function createAccessRequest(patientId: string): Promise<AccessRequestDoc> {
  const ref = doc(collection(db, "access_requests"));
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + ACCESS_REQUEST_TTL_MS));
  const data: Omit<AccessRequestDoc, "id" | "createdAt" | "claimedAt"> & {
    createdAt: unknown;
    claimedAt: null;
  } = {
    patientId,
    status: "awaiting_scan",
    createdAt: serverTimestamp(),
    expiresAt,
    claimedByOwnerUid: null,
    claimedByClinicSlug: null,
    claimedByClinicName: null,
    claimedAt: null,
  };
  await setDoc(ref, data);
  return { id: ref.id, ...data, createdAt: Timestamp.now() } as AccessRequestDoc;
}

export function watchAccessRequest(requestId: string, onChange: (req: AccessRequestDoc | null) => void): () => void {
  return onSnapshot(
    doc(db, "access_requests", requestId),
    (snap) => onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as AccessRequestDoc) : null),
    () => onChange(null)
  );
}

/** The clinic scanner's own step right after decoding a QR — "claims" the
 *  ticket, which is what makes it show up as an approve/deny prompt on
 *  the patient's still-open screen. firestore.rules rejects this outright
 *  if the ticket is already claimed/expired/not awaiting_scan, so the
 *  local expiry pre-check in qrPassport.ts is just a fast UX short-circuit,
 *  not the real enforcement. */
export async function claimAccessRequest(
  requestId: string,
  clinic: { ownerUid: string; slug: string; clinicName: string }
): Promise<void> {
  try {
    await updateDoc(doc(db, "access_requests", requestId), {
      status: "claimed",
      claimedByOwnerUid: clinic.ownerUid,
      claimedByClinicSlug: clinic.slug,
      claimedByClinicName: clinic.clinicName,
      claimedAt: serverTimestamp(),
    });
  } catch {
    throw new AccessRequestError("تعذّر استخدام هذا الرمز — قد يكون منتهي الصلاحية أو تم استخدامه من قبل.");
  }
}

/** Patient approves a claimed request: creates/refreshes the actual
 *  access_grants doc (this is the one write that actually grants
 *  anything) and marks the request "approved" so the clinic's own
 *  listener knows to proceed. */
export async function approveAccessRequest(req: AccessRequestDoc): Promise<void> {
  if (!req.claimedByOwnerUid || !req.claimedByClinicSlug || !req.claimedByClinicName) {
    throw new AccessRequestError("لا يوجد طلب وصول من عيادة لتأكيده.");
  }
  const grantedAt = Timestamp.now();
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + ACCESS_GRANT_MINUTES * 60 * 1000));
  await setDoc(doc(db, "access_grants", grantId(req.patientId, req.claimedByOwnerUid)), {
    patientId: req.patientId,
    clinicOwnerUid: req.claimedByOwnerUid,
    clinicSlug: req.claimedByClinicSlug,
    clinicName: req.claimedByClinicName,
    status: "active",
    grantedAt,
    expiresAt,
  });
  await updateDoc(doc(db, "access_requests", req.id), { status: "approved" });
}

export async function denyAccessRequest(requestId: string): Promise<void> {
  await updateDoc(doc(db, "access_requests", requestId), { status: "denied" });
}

// ---------------------------------------------------------------------
// access_grants/{patientId}_{clinicOwnerUid}
// ---------------------------------------------------------------------

export function isGrantActive(grant: Pick<AccessGrantDoc, "status" | "expiresAt">): boolean {
  return grant.status === "active" && grant.expiresAt.toMillis() > Date.now();
}

export async function getAccessGrant(patientId: string, clinicOwnerUid: string): Promise<AccessGrantDoc | null> {
  const snap = await getDoc(doc(db, "access_grants", grantId(patientId, clinicOwnerUid)));
  return snap.exists() ? (snap.data() as AccessGrantDoc) : null;
}

/** The clinic scanner's own wait step after claiming a request — fires
 *  the moment the patient approves (or denies/never responds — the caller
 *  is expected to pair this with its own request-status listener for the
 *  "denied" case, since a grant document never gets created on denial). */
export function watchAccessGrant(
  patientId: string,
  clinicOwnerUid: string,
  onChange: (grant: AccessGrantDoc | null) => void
): () => void {
  return onSnapshot(
    doc(db, "access_grants", grantId(patientId, clinicOwnerUid)),
    (snap) => onChange(snap.exists() ? (snap.data() as AccessGrantDoc) : null),
    () => onChange(null)
  );
}

/** The patient's own "إلغاء الوصول" button — ends a grant early, before
 *  its natural expiresAt. */
export async function revokeAccessGrant(patientId: string, clinicOwnerUid: string): Promise<void> {
  await updateDoc(doc(db, "access_grants", grantId(patientId, clinicOwnerUid)), { status: "revoked" });
}

/** Every grant a patient has ever issued (active or not) — powers
 *  /find/passport's "الجهات التي منحتها الوصول" list. Single-field
 *  equality only, same no-composite-index reasoning as everywhere else
 *  in this file. */
export async function listGrantsForPatient(patientId: string): Promise<AccessGrantDoc[]> {
  const q = query(collection(db, "access_grants"), where("patientId", "==", patientId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as AccessGrantDoc).sort((a, b) => b.grantedAt.toMillis() - a.grantedAt.toMillis());
}
