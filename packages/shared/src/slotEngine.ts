// Smart Slot Management — pure, framework-free scheduling logic.
//
// This module only does arithmetic on time strings; it never touches the
// database, which is what makes it trivial to unit test (see
// slotEngine.test.ts) and safe to reuse client-side later (e.g. to preview
// availability while offline, from the mirrored doctor/appointment tables).
//
// Double-booking prevention is a two-layer defense:
//   1. Here: we never *offer* a slot that a still-active appointment holds.
//   2. In appointments.service.ts: the actual INSERT relies on a unique DB
//      constraint (slotLockKey) so two concurrent requests for the same
//      free-looking slot can't both succeed — one loses the race atomically.
// Layer 1 gives good UX (grey out taken slots); layer 2 is what actually
// guarantees correctness under concurrency.

import type { BreakBlock, WorkingHoursBlock } from "./index";

export interface Slot {
  startTime: string; // "09:15"
  endTime: string; // "09:30"
}

export interface DoctorScheduleConfig {
  slotDurationMinutes: number;
  workingHours: WorkingHoursBlock[];
  breaks: BreakBlock[];
}

/** "09:05" -> 545 */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) {
    throw new Error(`Invalid time string: "${time}"`);
  }
  return h * 60 + m;
}

/** 545 -> "09:05" */
export function minutesToTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (totalMinutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function weekdayOf(dateISO: string): number {
  // Parsed as local midnight, not UTC, so the weekday matches the clinic's
  // wall-clock calendar regardless of server timezone.
  return new Date(`${dateISO}T00:00:00`).getDay();
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Splits a doctor's working hours for one calendar date into fixed-length
 * bookable slots, dropping any slot that falls (even partially) inside a
 * break block. This is the "تقسيم أوقات العمل" requirement.
 */
export function generateDaySlots(doctor: DoctorScheduleConfig, dateISO: string): Slot[] {
  const weekday = weekdayOf(dateISO);
  const duration = doctor.slotDurationMinutes;
  if (!duration || duration <= 0) {
    throw new Error("slotDurationMinutes must be a positive number");
  }

  const todaysBlocks = doctor.workingHours.filter((b) => b.weekday === weekday);
  const todaysBreaks = doctor.breaks.filter((b) => b.weekday === weekday);

  const slots: Slot[] = [];

  for (const block of todaysBlocks) {
    const blockStart = timeToMinutes(block.startTime);
    const blockEnd = timeToMinutes(block.endTime);

    for (let cursor = blockStart; cursor + duration <= blockEnd; cursor += duration) {
      const slotStart = cursor;
      const slotEnd = cursor + duration;

      const isDuringBreak = todaysBreaks.some((brk) =>
        overlaps(slotStart, slotEnd, timeToMinutes(brk.startTime), timeToMinutes(brk.endTime))
      );
      if (isDuringBreak) continue;

      slots.push({
        startTime: minutesToTime(slotStart),
        endTime: minutesToTime(slotEnd),
      });
    }
  }

  return slots;
}

/** Statuses that still "occupy" a slot and must block a rebooking. */
const OCCUPYING_STATUSES = new Set([
  "booked",
  "arrived",
  "in_progress",
  "completed",
  "no_show",
]);

export function isOccupyingStatus(status: string): boolean {
  return OCCUPYING_STATUSES.has(status);
}

/**
 * Given all of today's slots and the appointments already on the books,
 * returns only the slots that are still free to offer in the UI.
 * Cancelled appointments are treated as if they never happened.
 */
export function getAvailableSlots(
  doctor: DoctorScheduleConfig,
  dateISO: string,
  existingAppointments: { startTime: string; status: string }[]
): Slot[] {
  const takenStartTimes = new Set(
    existingAppointments.filter((a) => isOccupyingStatus(a.status)).map((a) => a.startTime)
  );
  return generateDaySlots(doctor, dateISO).filter((s) => !takenStartTimes.has(s.startTime));
}

/**
 * The value stored in Appointment.slotLockKey. Postgres unique indexes allow
 * unlimited NULLs, so returning null for a cancelled booking frees the slot
 * for reuse while every occupying status still collides on the same key —
 * this is what the DB-level double-booking guard is built on.
 */
export function buildSlotLockKey(
  doctorId: string,
  dateISO: string,
  startTime: string,
  status: string
): string | null {
  if (!isOccupyingStatus(status)) return null;
  return `${doctorId}|${dateISO}|${startTime}`;
}

export class SlotNotAvailableError extends Error {
  constructor(startTime: string) {
    super(`Slot ${startTime} is not part of the doctor's working hours or falls in a break.`);
    this.name = "SlotNotAvailableError";
  }
}

/** Validates a requested slot actually exists on the doctor's grid for that day, and returns its endTime. */
export function resolveSlotEndTime(
  doctor: DoctorScheduleConfig,
  dateISO: string,
  startTime: string
): string {
  const slot = generateDaySlots(doctor, dateISO).find((s) => s.startTime === startTime);
  if (!slot) throw new SlotNotAvailableError(startTime);
  return slot.endTime;
}

/**
 * Deterministic queue/ticket number for the waiting-room TV display: the
 * slot's 1-based position on the day's grid. Being a pure function of
 * (doctor, date, startTime) rather than "row count at insert time" means it
 * needs no extra locking and can never collide under concurrent bookings.
 */
export function queueNumberForSlot(
  doctor: DoctorScheduleConfig,
  dateISO: string,
  startTime: string
): number {
  const idx = generateDaySlots(doctor, dateISO).findIndex((s) => s.startTime === startTime);
  if (idx === -1) throw new SlotNotAvailableError(startTime);
  return idx + 1;
}
