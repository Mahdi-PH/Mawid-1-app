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

/** clinics/{slug} — slug is both the document id and the public booking
 *  username, e.g. #book/alnoor-demo in the artifact's link scheme. */
export interface ClinicDoc {
  slug: string;
  ownerUid: string;
  /** Denormalized from users/{ownerUid}.email so the admin pending-review
   *  list doesn't need a lookup per row. */
  email: string;
  clinicName: string;
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
