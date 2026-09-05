// Firestore document shapes for the Firebase-backed track of موعد.
//
// This is a deliberately different (flatter) schema than @mawid/shared's
// Postgres model: one working-hours block per clinic instead of per-weekday
// blocks, matching the demo artifact's model (which the user has already
// validated end-to-end) rather than the more general Postgres one. See
// docs/firebase-setup.md for how this track relates to apps/server.
//
// All createdAt/updatedAt fields are Firestore server timestamps (written
// via serverTimestamp() in firestore.ts), never a client-supplied Date.now()
// — that avoids trusting a client's clock and closes off a client spoofing
// its own registration date in the admin dashboard's user list.
import type { Timestamp } from "firebase/firestore";

export type UserRole = "admin" | "clinic";

/** users/{uid} — admin and clinic accounts only; anonymous patients never
 *  get a document here (see auth.ts ensureSignedIn()). */
export interface UserDoc {
  uid: string;
  email: string;
  role: UserRole;
  displayName: string;
  createdAt: Timestamp;
}

/** A clinic's registration/verification state. New signups always start
 *  "pending" — there is no client-side path to "approved" (see
 *  firestore.rules' clinics update rule, which locks this field to
 *  admin-only writes) since approval has to mean something. */
export type ClinicStatus = "pending" | "approved" | "rejected";

/** The center's own type, chosen once, required, at signup — drives every
 *  terminology swap this app makes (see lib/firebase/terminology.ts):
 *  "عيادة" (clinic) keeps the existing medical wording (مريض/طبيب/وصفة…);
 *  "beauty"/"salon" both switch to the same salon-style wording
 *  (زبون/حلاق أو أخصائي تجميل/جلسة…) — the two are distinguished from each
 *  other only by their own display label (see ENTITY_TYPE_LABEL), not by
 *  separate terminology, matching the user's own explicit grouping of the
 *  two under one wording set. Purely a display/classification field —
 *  appointment and queue-board isolation between clinics is already fully
 *  guaranteed by clinicSlug/ownerUid scoping everywhere else in this file
 *  and in firestore.rules, completely independent of this field, so it
 *  carries zero cross-tenant-isolation responsibility of its own. */
export type EntityType = "clinic" | "beauty" | "salon";

/** clinics/{slug} — slug is both the document id and the public booking
 *  username, e.g. #book/alnoor-demo in the artifact's link scheme. */
export interface ClinicDoc {
  slug: string;
  ownerUid: string;
  /** Denormalized from users/{ownerUid}.email so the admin pending-review
   *  list doesn't need a lookup per row. */
  email: string;
  clinicName: string;
  /** Required at signup, no default — see EntityType's own comment above.
   *  Docs created before this field existed simply lack it at runtime
   *  despite this non-optional type (Firestore is schemaless; TypeScript
   *  can't see the gap) — every reader goes through
   *  lib/firebase/terminology.ts's getTerminology(), which treats a
   *  missing/unrecognized value as "clinic" so an old doc silently keeps
   *  today's medical wording rather than crashing or showing "undefined". */
  entityType: EntityType;
  doctorName: string;
  specialty: string;
  gov: string | null;
  district: string | null;
  street: string | null;
  workStart: string; // "09:00"
  workEnd: string; // "17:00"
  slotMin: 5 | 10 | 15 | 20;
  breakStart: string | null;
  breakEnd: string | null;
  status: ClinicStatus;
  /** Storage download URL for the uploaded business license (clinic or
   *  beauty-center registration document) — see lib/firebase/storage.ts. */
  licenseImageUrl: string;
  /** null until first approved; set to approval-time + 30 days by
   *  adminSetClinicStatus(), extended another 30 days at a time by
   *  adminRenewSubscription() — there's no real payment gateway (see
   *  /subscribe), so renewal is always this manual admin action after
   *  the clinic pays via the account number shown there. Locked to
   *  admin-only writes in firestore.rules, same as `status`. */
  subscriptionEndsAt: Timestamp | null;
  /** null until first approved; set alongside subscriptionEndsAt at that
   *  same moment. Stays unchanged across an on-time renewal (the
   *  subscription is continuous, only its end date moves), but resets to
   *  the renewal moment if the clinic had already lapsed (a fresh period
   *  after a real gap) — same "on-time vs. lapsed" branch
   *  adminRenewSubscription() already uses for subscriptionEndsAt. Powers
   *  /clinic's "خطة الاشتراك" tab, which shows the clinic its own
   *  start-to-end subscription window. Locked to admin-only writes in
   *  firestore.rules, same as subscriptionEndsAt. */
  subscriptionStartedAt: Timestamp | null;
  createdAt: Timestamp;
}

export type AppointmentStatus =
  | "requested"
  | "booked"
  | "arrived"
  | "in_progress"
  | "completed"
  | "no_show"
  | "cancelled";

/** Statuses that hold the slot — mirrors OCCUPYING_STATUSES in
 *  @mawid/shared/slotEngine.ts. "requested" is included here (unlike the
 *  Postgres model, which has no such status) because a patient's pending
 *  request must block the same slot from being grabbed twice while the
 *  clinic hasn't confirmed it yet. */
export const OCCUPYING_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  "requested",
  "booked",
  "arrived",
  "in_progress",
  "completed",
  "no_show",
]);

/** appointments/{clinicSlug}_{date}_{startTime} — the deterministic id is
 *  the whole double-booking guard; see bookSlot() in firestore.ts. */
export interface AppointmentDoc {
  id: string;
  clinicSlug: string;
  date: string; // "2026-09-02"
  startTime: string; // "09:15"
  endTime: string;
  patientUid: string;
  patientName: string;
  patientPhone: string;
  status: AppointmentStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ---------------------------------------------------------------------
// Universal Patient Passport — QR-code medical archive (patient_records).
//
// Patient_ID here is deliberately the patient's existing Firebase
// Anonymous Auth uid (the same identity ensurePatientSession()/bookSlot()
// already use for appointments), NOT a phone-verified identity — real SMS
// verification (Firebase Phone Auth) was scoped out for this pass because
// it requires the paid Blaze plan to send live SMS in production, the same
// wall this project already hit with Firebase Storage (see CLAUDE.md).
// The user explicitly chose to keep the existing unverified local session
// as the identity for now rather than adopt Blaze. This means Patient_ID is
// only as trustworthy as "whoever currently holds this anonymous browser
// session" — disclosed here and in the UI, not hidden, same as every other
// local-only limitation already documented for this app (lib/patientLocal.ts).
//
// File storage (X-ray images, PDF reports) is also out of scope this pass —
// only text-based Medical_History/Previous_Prescriptions entries exist; see
// the "Lab_Reports_URLs" gap noted in CLAUDE.md when this was scoped.
// ---------------------------------------------------------------------

/** patient_records/{patientId} — patientId == the patient's own Firebase
 *  Auth uid (doc id). One profile doc per patient; the actual medical
 *  history/prescriptions live in the entries/ subcollection below, not as
 *  arrays on this doc, so "read-only archive, append-only new entries" can
 *  be enforced by firestore.rules per-entry rather than by trying to prove
 *  an array write only appended (which Firestore rules can't express). */
export interface PatientRecordDoc {
  patientId: string;
  fullName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type RecordEntryType = "history" | "prescription";
export type RecordEntryAuthor = "patient" | "clinic";

/** patient_records/{patientId}/entries/{entryId} — one immutable entry per
 *  medical-history note or prescription/report. Never updated or deleted
 *  once created (firestore.rules denies both to everyone but admin) — a
 *  correction is a new entry, not an edit, so the archive a doctor reads
 *  can never be silently altered after the fact. authorType "clinic"
 *  entries are only writable while that clinic holds an active
 *  AccessGrantDoc for this patient (see access_grants below); "patient"
 *  entries are self-reported notes the patient adds to their own record. */
export interface RecordEntryDoc {
  id: string;
  type: RecordEntryType;
  text: string;
  authorType: RecordEntryAuthor;
  /** Set only for authorType "clinic" — denormalized so the patient's own
   *  history view can show which clinic/doctor wrote each entry without an
   *  extra lookup. */
  clinicOwnerUid: string | null;
  clinicSlug: string | null;
  clinicName: string | null;
  createdAt: Timestamp;
}

export type AccessRequestStatus = "awaiting_scan" | "claimed" | "approved" | "denied" | "expired";

/** access_requests/{requestId} — requestId is a random, unguessable id
 *  (acts as the QR code's own short-lived bearer secret, since this
 *  project has no Cloud Functions/backend to issue a real signed token on
 *  the Spark plan — see docs/firebase-setup.md). Encoded into the QR
 *  alongside patientId + expiresAt; scanning it lets a clinic "claim" the
 *  request (proving it physically saw this exact, still-valid code), which
 *  then surfaces an approve/deny prompt on the patient's own open screen —
 *  the "temporary access permission" step this feature requires. Always
 *  short-lived (a few minutes) regardless of how long the resulting grant
 *  (access_grants) lasts. */
export interface AccessRequestDoc {
  id: string;
  patientId: string;
  status: AccessRequestStatus;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  claimedByOwnerUid: string | null;
  claimedByClinicSlug: string | null;
  claimedByClinicName: string | null;
  claimedAt: Timestamp | null;
}

export type AccessGrantStatus = "active" | "revoked" | "denied";

/** access_grants/{patientId}_{clinicOwnerUid} — deterministic id (one
 *  live grant per patient/clinic pair at a time, the same "compute the id,
 *  let Firestore itself arbitrate" pattern appointments/{...} already
 *  uses for double-booking) so firestore.rules can check "does this exact
 *  clinic currently have an active, unexpired grant for this exact
 *  patient" with a single get(), no query. Created only by the patient,
 *  only in response to approving a claimed AccessRequestDoc — never
 *  self-granted by a clinic. Read-only access to the archive; the doctor
 *  may still create new entries (see RecordEntryDoc) while a grant is
 *  active, which is not a write to this document itself. */
export interface AccessGrantDoc {
  patientId: string;
  clinicOwnerUid: string;
  clinicSlug: string;
  clinicName: string;
  status: AccessGrantStatus;
  grantedAt: Timestamp;
  expiresAt: Timestamp;
}

// ---------------------------------------------------------------------
// Live patient-facing queue board — clinic_queue_slots/{apptId} (same
// deterministic id as its matching appointments/{apptId}). Holds only
// clinicSlug/date/startTime/status, deliberately NO patientName/
// patientPhone, so it's safe to let any signed-in patient read the whole
// board for a given clinic/day (needed to compute "how many are ahead of
// me") without exposing anyone else's identity — see /find/wait and
// lib/firebase/queue.ts for how it's read/written.
// ---------------------------------------------------------------------

export interface ClinicQueueSlotDoc {
  clinicSlug: string;
  date: string;
  startTime: string;
  status: AppointmentStatus;
  updatedAt: Timestamp;
}
