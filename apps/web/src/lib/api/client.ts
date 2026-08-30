// Local-first data layer used by every screen.
//
// READS: always come from IndexedDB, computed with the same slotEngine the
// server uses (see @mawid/shared) so the timeline looks identical online or
// offline. `refreshFromServer()` opportunistically seeds/updates that local
// cache whenever a connection is available - it's a nice-to-have, not a
// dependency for rendering.
//
// WRITES: always go local-first through the sync queue (queueCreate /
// queueUpdate in ../offline/syncEngine) and are pushed to the server in the
// background. A receptionist on a bad connection never sees a spinner or a
// failed request - the write always "succeeds" instantly on the device and
// reconciles later.
"use client";

import { v4 as uuid } from "uuid";
import {
  generateDaySlots,
  isOccupyingStatus,
  queueNumberForSlot,
  resolveSlotEndTime,
  SlotNotAvailableError,
  type Appointment,
  type AppointmentStatus,
  type Doctor,
  type Patient,
  type Slot,
} from "@mawid/shared";
import { getDb } from "../offline/db";
import { queueCreate, queueUpdate } from "../offline/syncEngine";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

export interface DaySlotView extends Slot {
  appointment: (Appointment & { patient: Patient }) | null;
}

/** Best-effort pull of doctors + today's appointments into the local cache. No-op offline. */
export async function refreshFromServer(clinicId: string, doctorId: string, date: string) {
  if (typeof navigator === "undefined" || !navigator.onLine) return;
  const db = getDb();

  try {
    const doctorsRes = await fetch(`${API_BASE}/api/doctors?clinicId=${clinicId}`);
    if (doctorsRes.ok) {
      const doctors: Doctor[] = await doctorsRes.json();
      await db.doctors.bulkPut(doctors);
    }

    const dayRes = await fetch(`${API_BASE}/api/appointments/day?doctorId=${doctorId}&date=${date}`);
    if (dayRes.ok) {
      const day: DaySlotView[] = await dayRes.json();
      const appointments = day.map((s) => s.appointment).filter((a): a is NonNullable<typeof a> => !!a);
      await db.appointments.bulkPut(appointments);
      await db.patients.bulkPut(appointments.map((a) => a.patient));
    }
  } catch {
    // Offline or server unreachable - the local cache we already have is fine.
  }
}

/** The reception timeline: full slot grid for one doctor/day, computed locally. */
export async function getDayView(doctorId: string, date: string): Promise<DaySlotView[]> {
  const db = getDb();
  const doctor = await db.doctors.get(doctorId);
  if (!doctor) return [];

  const slots = generateDaySlots(doctor, date);
  const appointments = await db.appointments.where({ doctorId, date }).toArray();
  const byStart = new Map(appointments.map((a) => [a.startTime, a]));

  const result: DaySlotView[] = [];
  for (const slot of slots) {
    const appt = byStart.get(slot.startTime);
    if (!appt || appt.status === "cancelled") {
      result.push({ ...slot, appointment: null });
      continue;
    }
    const patient = await db.patients.get(appt.patientId);
    result.push({ ...slot, appointment: patient ? { ...appt, patient } : null });
  }
  return result;
}

export async function searchPatients(clinicId: string, phone: string): Promise<Patient[]> {
  const db = getDb();
  const all = await db.patients.where({ clinicId }).toArray();
  return all.filter((p) => p.phone.includes(phone)).slice(0, 10);
}

/** Quick-book step 1: find a patient by exact phone, or create one - all local-first. */
export async function findOrCreatePatient(input: {
  clinicId: string;
  fullName: string;
  phone: string;
  patientCode?: string;
}): Promise<Patient> {
  const db = getDb();
  const existing = await db.patients.where({ clinicId: input.clinicId, phone: input.phone }).first();
  if (existing) return existing;

  const patient: Patient = {
    id: uuid(),
    clinicId: input.clinicId,
    fullName: input.fullName,
    phone: input.phone,
    patientCode: input.patientCode,
    createdAt: new Date().toISOString(),
  };
  await queueCreate("patient", patient);
  return patient;
}

export class SlotTakenLocallyError extends Error {
  constructor(startTime: string) {
    super(`الوقت ${startTime} محجوز بالفعل على هذا الجهاز.`);
    this.name = "SlotTakenLocallyError";
  }
}

/**
 * Quick-book step 2: reserve a slot. Local-first - end time and queue
 * number are derived with the exact same slotEngine the server uses, so
 * they never disagree. This is only a *local* double-booking check (layer
 * 1 from slotEngine.ts); the authoritative guard is the server's unique
 * constraint, enforced once this device syncs (see SlotTakenError there).
 */
export async function bookAppointmentLocal(input: {
  clinicId: string;
  doctorId: string;
  patientId: string;
  date: string;
  startTime: string;
  notes?: string;
}): Promise<Appointment> {
  const db = getDb();
  const doctor = await db.doctors.get(input.doctorId);
  if (!doctor) throw new Error("Doctor not found in local cache - go online once to sync it.");

  const endTime = resolveSlotEndTime(doctor, input.date, input.startTime); // throws SlotNotAvailableError
  const queueNumber = queueNumberForSlot(doctor, input.date, input.startTime);

  const sameSlot = await db.appointments.where({ doctorId: input.doctorId, date: input.date }).toArray();
  if (sameSlot.some((a) => a.startTime === input.startTime && isOccupyingStatus(a.status))) {
    throw new SlotTakenLocallyError(input.startTime);
  }

  const appointment: Appointment = {
    id: uuid(),
    clinicId: input.clinicId,
    doctorId: input.doctorId,
    patientId: input.patientId,
    date: input.date,
    startTime: input.startTime,
    endTime,
    queueNumber,
    status: "booked",
    notes: input.notes,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await queueCreate("appointment", appointment);
  return appointment;
}

export { SlotNotAvailableError };

export async function setAppointmentStatus(appointmentId: string, status: AppointmentStatus) {
  await queueUpdate("appointment", appointmentId, { status, updatedAt: new Date().toISOString() });
}
