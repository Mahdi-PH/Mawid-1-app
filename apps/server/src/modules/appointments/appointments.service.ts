import { Prisma, AppointmentStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import {
  buildSlotLockKey,
  generateDaySlots,
  queueNumberForSlot,
  resolveSlotEndTime,
  type DoctorScheduleConfig,
} from "@mawid/shared";

export class SlotTakenError extends Error {
  constructor(startTime: string) {
    super(`Slot ${startTime} was just booked by someone else. Pick another slot.`);
    this.name = "SlotTakenError";
  }
}

async function loadDoctorScheduleConfig(doctorId: string): Promise<DoctorScheduleConfig> {
  const doctor = await prisma.doctor.findUniqueOrThrow({
    where: { id: doctorId },
    include: { workingHours: true, breaks: true },
  });
  return {
    slotDurationMinutes: doctor.slotDurationMinutes,
    workingHours: doctor.workingHours,
    breaks: doctor.breaks,
  };
}

export interface BookAppointmentInput {
  clinicId: string;
  doctorId: string;
  patientId: string;
  date: string;
  startTime: string;
  notes?: string;
  /** Present when this booking originated from an offline client, for idempotent replay. */
  localId?: string;
}

/**
 * The single write path for creating an appointment. Concurrency-safety
 * comes entirely from the DB: slotLockKey is unique, so if two receptionists
 * (or an offline device syncing late) both try to grab "09:00" for the same
 * doctor/date, the loser's INSERT throws Postgres error P2002 and we surface
 * that as SlotTakenError instead of silently double-booking.
 */
export async function bookAppointment(input: BookAppointmentInput) {
  const schedule = await loadDoctorScheduleConfig(input.doctorId);

  // Throws SlotNotAvailableError if outside working hours / inside a break.
  const endTime = resolveSlotEndTime(schedule, input.date, input.startTime);
  const queueNumber = queueNumberForSlot(schedule, input.date, input.startTime);
  const slotLockKey = buildSlotLockKey(input.doctorId, input.date, input.startTime, "booked");

  try {
    return await prisma.appointment.create({
      data: {
        clinicId: input.clinicId,
        doctorId: input.doctorId,
        patientId: input.patientId,
        date: input.date,
        startTime: input.startTime,
        endTime,
        queueNumber,
        notes: input.notes,
        status: AppointmentStatus.booked,
        slotLockKey,
        localId: input.localId,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new SlotTakenError(input.startTime);
    }
    throw err;
  }
}

/**
 * Status transitions (arrived / in_progress / completed / cancelled / no_show).
 * Recomputes slotLockKey on every transition so a cancellation immediately
 * frees the slot for rebooking, and re-booking that slot for someone else
 * fails cleanly if a race lands here first.
 */
export async function updateAppointmentStatus(appointmentId: string, status: AppointmentStatus) {
  const appt = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  const slotLockKey = buildSlotLockKey(appt.doctorId, appt.date, appt.startTime, status);

  try {
    return await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status, slotLockKey },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new SlotTakenError(appt.startTime);
    }
    throw err;
  }
}

export async function listAppointmentsForDoctorDate(doctorId: string, date: string) {
  return prisma.appointment.findMany({
    where: { doctorId, date },
    include: { patient: true },
    orderBy: { startTime: "asc" },
  });
}

/** Powers the reception timeline: full day grid merged with booked appointments. */
export async function getDoctorDayView(doctorId: string, date: string) {
  const schedule = await loadDoctorScheduleConfig(doctorId);
  const appointments = await listAppointmentsForDoctorDate(doctorId, date);
  const slots = generateDaySlots(schedule, date);

  const byStartTime = new Map(appointments.map((a) => [a.startTime, a]));
  return slots.map((slot) => ({
    ...slot,
    appointment: byStartTime.get(slot.startTime) ?? null,
  }));
}
