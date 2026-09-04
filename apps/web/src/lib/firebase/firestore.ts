"use client";

import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "./config";
import { compressLicenseImageToDataUrl } from "./licenseImage";
import { syncQueueSlot } from "./queue";
import { generateDaySlots, resolveSlotEndTime } from "./slotEngine";
import { OCCUPYING_STATUSES } from "./types";
import type { AppointmentDoc, AppointmentStatus, ClinicDoc, ClinicStatus, UserDoc } from "./types";

export class SlugTakenError extends Error {
  constructor(slug: string) {
    super(`Username "${slug}" is already taken.`);
    this.name = "SlugTakenError";
  }
}
export class SlotTakenError extends Error {
  constructor(startTime: string) {
    super(`${startTime} was just booked by someone else — pick another time.`);
    this.name = "SlotTakenError";
  }
}
export class ScheduleConflictError extends Error {
  constructor(public conflictingTimes: string[]) {
    super(`These booked appointments fall outside the new hours: ${conflictingTimes.join(", ")}`);
    this.name = "ScheduleConflictError";
  }
}

/** One real subscription month == 30 days, counted from the moment admin
 *  approves a clinic (not from signup — a pending clinic isn't live/usable
 *  yet, so it shouldn't burn subscription time while waiting on review),
 *  and renewed the same way (adminRenewSubscription()) since there's no
 *  real payment gateway (see /subscribe) — a human admin confirms the
 *  manual bank transfer and clicks "تجديد شهر". */
const SUBSCRIPTION_DAYS = 30;
/** Clinic shows an in-app warning banner (see /clinic) once its
 *  subscription is within this many days of expiring. */
export const SUBSCRIPTION_WARNING_DAYS = 1;

/** The manual bank/wallet transfer target shown for subscription payment —
 *  informational only, no real payment gateway. Shared by /clinic's
 *  "خطة الاشتراك" tab (the only place it's shown after login, per the
 *  user's explicit ask) and /subscribe's pre-signup marketing card. */
export const SUBSCRIPTION_PAYMENT_ACCOUNT = "910459764999";

function addDays(from: Date, days: number): Timestamp {
  return Timestamp.fromDate(new Date(from.getTime() + days * 24 * 60 * 60 * 1000));
}

/** true if the clinic has never been approved yet (no subscription clock
 *  started) or its subscription end date is still in the future. Expired
 *  clinics are treated as invisible/inactive everywhere patient-facing. */
export function isSubscriptionActive(clinic: Pick<ClinicDoc, "subscriptionEndsAt">): boolean {
  if (!clinic.subscriptionEndsAt) return false;
  return clinic.subscriptionEndsAt.toMillis() > Date.now();
}

/** Whole days left until expiry, floor()'d — negative once expired. */
export function subscriptionDaysLeft(clinic: Pick<ClinicDoc, "subscriptionEndsAt">): number | null {
  if (!clinic.subscriptionEndsAt) return null;
  return Math.floor((clinic.subscriptionEndsAt.toMillis() - Date.now()) / (24 * 60 * 60 * 1000));
}

// ---------------------------------------------------------------------
// Clinic account creation
// ---------------------------------------------------------------------

export interface RegisterClinicInput {
  email: string;
  password: string;
  clinicName: string;
  /** The business-license image file, straight from a file input —
   *  registerClinic() compresses it to a data: URL itself (see
   *  licenseImage.ts) and stores it inline on the clinic doc; there is no
   *  Firebase Storage upload (see that file's comment for why). */
  licenseImageFile: File;
  /** Public booking-link slug. Omit to auto-generate one from the email's
   *  local part (see generateUniqueSlugFromEmail) — there is no
   *  user-facing "username" field in the signup form by design. */
  slug?: string;
  doctorName?: string;
  specialty?: string;
  gov?: string | null;
  district?: string | null;
  street?: string | null;
  workStart?: string;
  workEnd?: string;
  slotMin?: 5 | 10 | 15 | 20;
  breakStart?: string | null;
  breakEnd?: string | null;
}

export async function isSlugAvailable(slug: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "clinics", slug));
  return !snap.exists();
}

function slugBaseFromEmail(email: string): string {
  const local = (email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return local.length >= 3 ? local.slice(0, 32) : `${local || "clinic"}-account`;
}

/** Derives the public booking-link slug from the clinic's Gmail address
 *  (the only identifier the signup form actually collects) rather than a
 *  separate username field, retrying with a numeric suffix on collision.
 *  This is a best-effort pre-check for a good default; the real
 *  uniqueness guarantee is the transaction inside registerClinic(). */
export async function generateUniqueSlugFromEmail(email: string): Promise<string> {
  const base = slugBaseFromEmail(email);
  let candidate = base;
  for (let n = 2; n <= 50; n++) {
    if (await isSlugAvailable(candidate)) return candidate;
    candidate = `${base}-${n}`.slice(0, 32);
  }
  throw new Error("Could not find an available booking-link slug for this email.");
}

/** Creates the Auth account, then atomically claims the slug + writes the
 *  users/clinics docs in one transaction, with status "pending" — every
 *  new clinic/beauty-center needs admin approval (see the dashboard's
 *  approve/reject buttons) before it's a real, live listing. If the slug
 *  turns out to be taken (lost a race, or the caller skipped the
 *  availability check), the just-created Auth account is deleted so it
 *  isn't left orphaned. */
export async function registerClinic(input: RegisterClinicInput): Promise<{ slug: string }> {
  const cred = await createUserWithEmailAndPassword(auth, input.email, input.password);
  const uid = cred.user.uid;

  try {
    const [slug, licenseImageUrl] = await Promise.all([
      input.slug ?? generateUniqueSlugFromEmail(input.email),
      compressLicenseImageToDataUrl(input.licenseImageFile),
    ]);
    await runTransaction(db, async (tx) => {
      const clinicRef = doc(db, "clinics", slug);
      const existing = await tx.get(clinicRef);
      if (existing.exists()) throw new SlugTakenError(slug);

      const userRef = doc(db, "users", uid);
      const userDoc: Omit<UserDoc, "createdAt"> & { createdAt: unknown } = {
        uid,
        email: input.email,
        role: "clinic",
        displayName: input.clinicName,
        createdAt: serverTimestamp(),
      };
      const clinicDoc: Omit<ClinicDoc, "createdAt"> & { createdAt: unknown } = {
        slug,
        ownerUid: uid,
        email: input.email,
        clinicName: input.clinicName,
        doctorName: input.doctorName || "الطبيب المناوب",
        specialty: input.specialty || "عيادة عامة",
        gov: input.gov ?? null,
        district: input.district ?? null,
        street: input.street ?? null,
        workStart: input.workStart || "09:00",
        workEnd: input.workEnd || "17:00",
        slotMin: input.slotMin || 15,
        breakStart: input.breakStart ?? null,
        breakEnd: input.breakEnd ?? null,
        status: "pending",
        licenseImageUrl,
        subscriptionEndsAt: null,
        subscriptionStartedAt: null,
        createdAt: serverTimestamp(),
      };
      tx.set(userRef, userDoc);
      tx.set(clinicRef, clinicDoc);
    });
    return { slug };
  } catch (err) {
    await cred.user.delete().catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------
// Clinic reads/updates
// ---------------------------------------------------------------------

export async function getClinic(slug: string): Promise<ClinicDoc | null> {
  const snap = await getDoc(doc(db, "clinics", slug));
  return snap.exists() ? (snap.data() as ClinicDoc) : null;
}

export async function listClinics(): Promise<ClinicDoc[]> {
  const snap = await getDocs(collection(db, "clinics"));
  return snap.docs.map((d) => d.data() as ClinicDoc);
}

/** Finds the clinic a signed-in clinic account owns — the /clinic
 *  dashboard's entry point, same ownerUid == uid relationship
 *  firestore.rules' ownsClinic() already checks for every write on this
 *  page. A clinic account owns exactly one clinic doc (registerClinic()
 *  never creates more than one per uid). */
export async function getClinicByOwner(ownerUid: string): Promise<ClinicDoc | null> {
  const snap = await getDocs(query(collection(db, "clinics"), where("ownerUid", "==", ownerUid)));
  return snap.empty ? null : (snap.docs[0].data() as ClinicDoc);
}

/** The patient-facing directory: single-field equality only (no orderBy),
 *  same reasoning as adminListPendingClinics() — avoids needing a
 *  composite index, and the result set is small enough to sort
 *  client-side. Only "approved" clinics are ever returned; "pending"/
 *  "rejected" stay invisible to مراجع, exactly like the admin approval
 *  workflow intends. A clinic whose subscription has expired is filtered
 *  out here too — per the user's explicit decision, an expired clinic
 *  disappears from search completely, the same as a pending/rejected one,
 *  even though its Firestore status field still literally says
 *  "approved" (status and subscription are deliberately separate axes —
 *  see adminRenewSubscription()). */
export async function listApprovedClinics(): Promise<ClinicDoc[]> {
  const q = query(collection(db, "clinics"), where("status", "==", "approved"));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => d.data() as ClinicDoc)
    .filter(isSubscriptionActive)
    .sort((a, b) => a.clinicName.localeCompare(b.clinicName, "ar"));
}

export interface ScheduleUpdate {
  workStart: string;
  workEnd: string;
  slotMin: 5 | 10 | 15 | 20;
  breakStart?: string | null;
  breakEnd?: string | null;
}

/** Same rule the demo artifact enforces on this same screen: refuses to
 *  save if any still-booked appointment (today or later — a real backend
 *  can't scope this to "today" the way the single-session artifact does)
 *  would fall outside the new grid.
 *
 *  Real bug fixed here: the query used to also filter `where("date", ">=",
 *  todayISO)` — a second, range clause on top of the clinicSlug equality
 *  clause — which needs a composite index Firestore never got a chance to
 *  build (same `datastore.indexAdmin` permission gap already hit by
 *  adminListPendingClinics()/listAppointmentsForPatient() — see their own
 *  comments). Firestore's "this query requires an index" error was thrown
 *  on every single save, so حفظ never actually completed regardless of
 *  what was typed. Fixed the same way those two were: drop the range
 *  clause, filter the (small, single-clinic) result client-side instead —
 *  needs zero indexes. */
export async function updateClinicSchedule(slug: string, patch: ScheduleUpdate): Promise<void> {
  const todayISO = new Date().toISOString().slice(0, 10);
  const q = query(collection(db, "appointments"), where("clinicSlug", "==", slug));
  const snap = await getDocs(q);
  const newSlotTimes = new Set(
    generateDaySlots({ ...patch, breakStart: patch.breakStart ?? null, breakEnd: patch.breakEnd ?? null }).map(
      (s) => s.startTime
    )
  );

  const conflicts = snap.docs
    .map((d) => d.data() as AppointmentDoc)
    .filter((a) => a.date >= todayISO && OCCUPYING_STATUSES.has(a.status) && !newSlotTimes.has(a.startTime))
    .map((a) => `${a.date} ${a.startTime}`)
    .sort();

  if (conflicts.length) throw new ScheduleConflictError(conflicts);

  await updateDoc(doc(db, "clinics", slug), {
    workStart: patch.workStart,
    workEnd: patch.workEnd,
    slotMin: patch.slotMin,
    breakStart: patch.breakStart ?? null,
    breakEnd: patch.breakEnd ?? null,
  });
}

// ---------------------------------------------------------------------
// Appointments — booking is the one write that must be race-safe.
// ---------------------------------------------------------------------

function apptId(clinicSlug: string, date: string, startTime: string) {
  return `${clinicSlug}_${date}_${startTime}`;
}

/** Exposed so a caller that just booked a slot (which knows clinicSlug/date/
 *  startTime but never gets the appointment doc back from bookSlot()) can
 *  compute the same deterministic id to open /find/wait with. */
export function getAppointmentId(clinicSlug: string, date: string, startTime: string): string {
  return apptId(clinicSlug, date, startTime);
}

/** Live status updates for the patient-facing waiting screen (/find/wait) —
 *  a plain getDoc() would need polling to notice the clinic marking the
 *  patient "arrived"/"in_progress"; onSnapshot pushes the change instead.
 *  Firestore rules already let a patient read their own appointment doc in
 *  full, so no rules change was needed for this. Returns the unsubscribe
 *  function.
 *
 *  The error callback matters as much as the success one here: opening
 *  this link for an appointment that isn't yours (or that never existed)
 *  hits firestore.rules' permission-denied, same as any not-found case
 *  from the visitor's point of view — without this, onSnapshot logs the
 *  error to the console and just stops, leaving onChange() never called
 *  again and the page stuck on "جارٍ التحميل" forever instead of falling
 *  back to the not-found state. */
export function watchAppointment(
  appointmentId: string,
  onChange: (appt: AppointmentDoc | null) => void
): () => void {
  return onSnapshot(
    doc(db, "appointments", appointmentId),
    (snap) => {
      onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as AppointmentDoc) : null);
    },
    () => onChange(null)
  );
}

/** Per-slot availability for the patient-facing booking grid, without ever
 *  reading another patient's name/phone. A plain query for "today's
 *  appointments at this clinic" isn't an option for an anonymous patient —
 *  firestore.rules only lets a signed-in visitor read an appointment doc
 *  that's theirs, the clinic's own, admin's, or (see that rule's comment)
 *  one that doesn't exist yet. So this checks each slot's deterministic id
 *  individually: a doc that doesn't exist reads fine and means "free"; a
 *  doc that exists and belongs to someone else is denied by the rules
 *  engine itself, which this reads as "taken" rather than treating as an
 *  error. Costs one Firestore read per slot on the grid (a few dozen at
 *  most for a single clinic/day) - fine at this app's current scale. */
export async function getSlotAvailability(
  clinicSlug: string,
  date: string,
  startTimes: string[]
): Promise<Record<string, boolean>> {
  const results = await Promise.allSettled(
    startTimes.map((startTime) => getDoc(doc(db, "appointments", apptId(clinicSlug, date, startTime))))
  );
  const availability: Record<string, boolean> = {};
  results.forEach((result, i) => {
    const startTime = startTimes[i];
    if (result.status === "rejected") {
      availability[startTime] = false; // permission-denied => exists, owned by someone else
      return;
    }
    availability[startTime] = !result.value.exists();
  });
  return availability;
}

export interface BookSlotInput {
  clinicSlug: string;
  date: string;
  startTime: string;
  patientUid: string;
  patientName: string;
  patientPhone: string;
}

/** The double-booking guard. Reads the deterministic appointment doc inside
 *  a transaction; if it's absent or its status isn't occupying, writes the
 *  new booking, otherwise throws. Firestore serializes transactions that
 *  touch the same document, so of two concurrent calls for the same slot
 *  exactly one commits — the other's transaction function re-runs, observes
 *  the now-occupied doc, and throws SlotTakenError. This is the Firestore-
 *  native equivalent of the Postgres slotLockKey unique-index guard. */
export async function bookSlot(input: BookSlotInput): Promise<void> {
  const clinic = await getClinic(input.clinicSlug);
  if (!clinic) throw new Error(`Unknown clinic "${input.clinicSlug}"`);
  if (clinic.status !== "approved" || !isSubscriptionActive(clinic)) {
    throw new Error(`Clinic "${input.clinicSlug}" is not currently accepting bookings.`);
  }
  const endTime = resolveSlotEndTime(clinic, input.startTime); // throws SlotNotAvailableError if off-grid

  const ref = doc(db, "appointments", apptId(input.clinicSlug, input.date, input.startTime));
  await runTransaction(db, async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists() && OCCUPYING_STATUSES.has((existing.data() as AppointmentDoc).status)) {
      throw new SlotTakenError(input.startTime);
    }
    const data: Omit<AppointmentDoc, "createdAt" | "updatedAt"> & { createdAt: unknown; updatedAt: unknown } = {
      id: ref.id,
      clinicSlug: input.clinicSlug,
      date: input.date,
      startTime: input.startTime,
      endTime,
      patientUid: input.patientUid,
      patientName: input.patientName,
      patientPhone: input.patientPhone,
      status: "requested",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    tx.set(ref, data);
  });
  // Best-effort — see syncQueueSlot()'s own comment for why a failure
  // here doesn't (and shouldn't) fail the booking itself, which has
  // already committed by this point.
  syncQueueSlot(input.clinicSlug, input.date, input.startTime, "requested");
}

export async function setAppointmentStatus(
  appt: Pick<AppointmentDoc, "id" | "clinicSlug" | "date" | "startTime">,
  status: AppointmentStatus
): Promise<void> {
  await updateDoc(doc(db, "appointments", appt.id), { status, updatedAt: serverTimestamp() });
  syncQueueSlot(appt.clinicSlug, appt.date, appt.startTime, status);
}

export async function deleteAppointment(appointmentId: string): Promise<void> {
  await deleteDoc(doc(db, "appointments", appointmentId));
}

export async function listAppointmentsForClinic(clinicSlug: string, date: string): Promise<AppointmentDoc[]> {
  const q = query(
    collection(db, "appointments"),
    where("clinicSlug", "==", clinicSlug),
    where("date", "==", date)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as AppointmentDoc);
}

/** Single-field equality only (no orderBy) - same reasoning as
 *  adminListPendingClinics(): a (patientUid, createdAt) composite index is
 *  already declared in firestore.indexes.json, but per docs/
 *  firebase-setup.md the service account that would deploy it lacks
 *  datastore.indexAdmin, so it was never actually pushed live. Sorting the
 *  small per-patient result set client-side needs zero index deployment. */
export async function listAppointmentsForPatient(patientUid: string): Promise<AppointmentDoc[]> {
  const q = query(collection(db, "appointments"), where("patientUid", "==", patientUid));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => d.data() as AppointmentDoc)
    .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
}

// ---------------------------------------------------------------------
// Admin dashboard reads — everything here relies on the admin custom claim
// via firestore.rules; a non-admin calling these gets a permission-denied
// error from Firestore itself, not a silently empty result.
// ---------------------------------------------------------------------

export async function adminListUsers(): Promise<UserDoc[]> {
  const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as UserDoc);
}

export async function adminGetUser(uid: string): Promise<UserDoc | null> {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? (snap.data() as UserDoc) : null;
}

export async function adminListAppointmentsForUser(uid: string): Promise<AppointmentDoc[]> {
  // A "user" in the admin list is a clinic account; its appointments are
  // whichever clinic doc has ownerUid == uid.
  const clinicSnap = await getDocs(query(collection(db, "clinics"), where("ownerUid", "==", uid)));
  if (clinicSnap.empty) return [];
  const slug = clinicSnap.docs[0].id;
  const q = query(collection(db, "appointments"), where("clinicSlug", "==", slug), orderBy("date", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as AppointmentDoc);
}

/** getCountFromServer bills as a single read regardless of collection size —
 *  far cheaper than getDocs().length for the dashboard's stat tiles, which
 *  matters on Spark's daily read quota (see docs/firebase-setup.md). */
export async function adminGetStats(): Promise<{ userCount: number; appointmentCount: number }> {
  const [users, appts] = await Promise.all([
    getCountFromServer(collection(db, "users")),
    getCountFromServer(collection(db, "appointments")),
  ]);
  return { userCount: users.data().count, appointmentCount: appts.data().count };
}

/** Single-field equality only (no orderBy) - deliberately avoids needing a
 *  composite (status, createdAt) index at all, rather than depend on the
 *  service account's undeployed datastore.indexAdmin permission (see
 *  docs/firebase-setup.md). The pending queue is small for a handful of
 *  pilot clinics, so sorting the already-fetched docs client-side costs
 *  nothing extra and needs zero index deployment. */
export async function adminListPendingClinics(): Promise<ClinicDoc[]> {
  const q = query(collection(db, "clinics"), where("status", "==", "pending"));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => d.data() as ClinicDoc)
    .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
}

/** Approve/reject a pending signup. firestore.rules only lets admin move
 *  status away from "pending" — a clinic can never do this to itself.
 *  Approving also starts the clinic's subscription clock — SUBSCRIPTION_DAYS
 *  from right now — since that's the first moment the clinic is actually
 *  live/usable; rejecting leaves subscriptionEndsAt untouched (null). */
export async function adminSetClinicStatus(slug: string, status: ClinicStatus): Promise<void> {
  const patch: { status: ClinicStatus; subscriptionEndsAt?: Timestamp; subscriptionStartedAt?: Timestamp } = { status };
  if (status === "approved") {
    const now = new Date();
    patch.subscriptionStartedAt = Timestamp.fromDate(now);
    patch.subscriptionEndsAt = addDays(now, SUBSCRIPTION_DAYS);
  }
  await updateDoc(doc(db, "clinics", slug), patch);
}

/** Every clinic that has ever been approved (regardless of whether its
 *  subscription is currently active or expired) — the admin subscription-
 *  tracking table's data source. Unlike listApprovedClinics(), this
 *  deliberately does NOT filter out expired ones: the whole point of this
 *  view is to let admin see and renew clinics that ran out. */
export async function adminListApprovedClinics(): Promise<ClinicDoc[]> {
  const q = query(collection(db, "clinics"), where("status", "==", "approved"));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => d.data() as ClinicDoc)
    .sort((a, b) => (a.subscriptionEndsAt?.toMillis() ?? 0) - (b.subscriptionEndsAt?.toMillis() ?? 0));
}

/** Every clinic signup admin has rejected — previously had no admin-side
 *  view at all (a rejected clinic just vanished from every other filtered
 *  list, leaving the doc orphaned in Firestore with nothing pointing at
 *  it). Same no-orderBy/sort-client-side reasoning as the other admin
 *  list functions here — avoids needing a composite index for a small
 *  result set. */
export async function adminListRejectedClinics(): Promise<ClinicDoc[]> {
  const q = query(collection(db, "clinics"), where("status", "==", "rejected"));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => d.data() as ClinicDoc)
    .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
}

/** Permanently deletes a clinic account: both its clinics/{slug} doc and
 *  the owning users/{uid} doc, in one atomic batch so the two can never
 *  go out of sync (a lone orphaned clinics doc with no matching users doc,
 *  or vice versa, would confuse every other admin/list function here that
 *  assumes the pair always exists together — exactly how registerClinic()
 *  creates them). Does NOT delete the underlying Firebase Auth account —
 *  that needs Admin SDK privileges no client (this admin dashboard
 *  included) legitimately holds; deleting these two docs still leaves the
 *  account functionally dead, since every real feature (getClinicByOwner,
 *  ownsClinic() in firestore.rules) depends on the clinics doc existing. */
export async function adminDeleteClinicAccount(clinic: Pick<ClinicDoc, "slug" | "ownerUid">): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, "clinics", clinic.slug));
  batch.delete(doc(db, "users", clinic.ownerUid));
  await batch.commit();
}

/** Manual "تجديد شهر" admin action — there's no real payment gateway (see
 *  /subscribe), so this is the human confirmation step after a clinic pays
 *  via the account number shown there. Extends SUBSCRIPTION_DAYS from the
 *  clinic's current expiry if it hasn't lapsed yet (so renewing a few days
 *  early doesn't lose those days), or from right now if it already
 *  expired (so a lapsed clinic doesn't get backdated free days). */
export async function adminRenewSubscription(slug: string): Promise<void> {
  const clinic = await getClinic(slug);
  if (!clinic) throw new Error(`Unknown clinic "${slug}"`);
  const now = new Date();
  const active = isSubscriptionActive(clinic);
  const base = active ? clinic.subscriptionEndsAt!.toDate() : now;
  await updateDoc(doc(db, "clinics", slug), {
    subscriptionEndsAt: addDays(base, SUBSCRIPTION_DAYS),
    // On-time renewal: the subscription is continuous, so its start date
    // doesn't move — only the end date does. Lapsed renewal: a real gap
    // just happened, so this is honestly a fresh period starting now,
    // same "no backdated free days" reasoning subscriptionEndsAt uses.
    subscriptionStartedAt: active ? clinic.subscriptionStartedAt ?? Timestamp.fromDate(now) : Timestamp.fromDate(now),
  });
}
