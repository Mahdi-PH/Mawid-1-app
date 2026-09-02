"use client";

import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "./config";
import { generateDaySlots, resolveSlotEndTime } from "./slotEngine";
import { OCCUPYING_STATUSES } from "./types";
import type { AppointmentDoc, AppointmentStatus, ClinicDoc, UserDoc } from "./types";

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

// ---------------------------------------------------------------------
// Clinic account creation
// ---------------------------------------------------------------------

export interface RegisterClinicInput {
  email: string;
  password: string;
  slug: string;
  clinicName: string;
  doctorName: string;
  specialty: string;
  gov: string | null;
  district: string | null;
  street: string | null;
  workStart: string;
  workEnd: string;
  slotMin: 5 | 10 | 15 | 20;
  breakStart?: string | null;
  breakEnd?: string | null;
}

/** Creates the Auth account, then atomically claims the slug + writes the
 *  users/clinics docs in one transaction. If the slug turns out to be taken
 *  (lost a race, or the caller skipped the availability check), the
 *  just-created Auth account is deleted so it isn't left orphaned. */
export async function registerClinic(input: RegisterClinicInput): Promise<void> {
  const cred = await createUserWithEmailAndPassword(auth, input.email, input.password);
  const uid = cred.user.uid;

  try {
    await runTransaction(db, async (tx) => {
      const clinicRef = doc(db, "clinics", input.slug);
      const existing = await tx.get(clinicRef);
      if (existing.exists()) throw new SlugTakenError(input.slug);

      const userRef = doc(db, "users", uid);
      const userDoc: Omit<UserDoc, "createdAt"> & { createdAt: unknown } = {
        uid,
        email: input.email,
        role: "clinic",
        displayName: input.clinicName,
        createdAt: serverTimestamp(),
      };
      const clinicDoc: Omit<ClinicDoc, "createdAt"> & { createdAt: unknown } = {
        slug: input.slug,
        ownerUid: uid,
        clinicName: input.clinicName,
        doctorName: input.doctorName,
        specialty: input.specialty,
        gov: input.gov,
        district: input.district,
        street: input.street,
        workStart: input.workStart,
        workEnd: input.workEnd,
        slotMin: input.slotMin,
        breakStart: input.breakStart ?? null,
        breakEnd: input.breakEnd ?? null,
        createdAt: serverTimestamp(),
      };
      tx.set(userRef, userDoc);
      tx.set(clinicRef, clinicDoc);
    });
  } catch (err) {
    await cred.user.delete().catch(() => {});
    throw err;
  }
}

export async function isSlugAvailable(slug: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "clinics", slug));
  return !snap.exists();
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
 *  would fall outside the new grid. */
export async function updateClinicSchedule(slug: string, patch: ScheduleUpdate): Promise<void> {
  const todayISO = new Date().toISOString().slice(0, 10);
  const q = query(
    collection(db, "appointments"),
    where("clinicSlug", "==", slug),
    where("date", ">=", todayISO)
  );
  const snap = await getDocs(q);
  const newSlotTimes = new Set(
    generateDaySlots({ ...patch, breakStart: patch.breakStart ?? null, breakEnd: patch.breakEnd ?? null }).map(
      (s) => s.startTime
    )
  );

  const conflicts = snap.docs
    .map((d) => d.data() as AppointmentDoc)
    .filter((a) => OCCUPYING_STATUSES.has(a.status) && !newSlotTimes.has(a.startTime))
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
}

export async function setAppointmentStatus(appointmentId: string, status: AppointmentStatus): Promise<void> {
  await updateDoc(doc(db, "appointments", appointmentId), { status, updatedAt: serverTimestamp() });
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

export async function listAppointmentsForPatient(patientUid: string): Promise<AppointmentDoc[]> {
  const q = query(
    collection(db, "appointments"),
    where("patientUid", "==", patientUid),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as AppointmentDoc);
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
