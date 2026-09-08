// Slot generation for the flat ClinicDoc schedule shape (workStart/workEnd/
// slotMin/breakStart/breakEnd) — the Firestore-track counterpart to
// @mawid/shared/slotEngine.ts, which uses per-weekday blocks instead. Pure
// arithmetic, no Firestore calls, so it's usable both client-side (render a
// grid) and inside firestore.ts's booking transaction (validate a requested
// startTime actually exists on the grid before writing).

import type { AppointmentStatus, ClinicDoc } from "./types";
import { OCCUPYING_STATUSES } from "./types";
import { getClinicTimezone, zonedTimeToUtcMillis } from "../time/clinicTime";

export interface Slot {
  startTime: string;
  endTime: string;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) throw new Error(`Invalid time string: "${time}"`);
  return h * 60 + m;
}

function minutesToTime(total: number): string {
  const h = Math.floor(total / 60).toString().padStart(2, "0");
  const m = (total % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Walks workStart..workEnd in slotMin steps, skipping any step that
 *  overlaps breakStart..breakEnd — "available only during clinic hours"
 *  holds by construction, exactly like the demo artifact's generateSlotsFor(). */
export function generateDaySlots(clinic: Pick<ClinicDoc, "workStart" | "workEnd" | "slotMin" | "breakStart" | "breakEnd">): Slot[] {
  const start = timeToMinutes(clinic.workStart);
  const end = timeToMinutes(clinic.workEnd);
  const hasBreak = Boolean(clinic.breakStart && clinic.breakEnd);
  const breakStart = hasBreak ? timeToMinutes(clinic.breakStart as string) : 0;
  const breakEnd = hasBreak ? timeToMinutes(clinic.breakEnd as string) : 0;

  const slots: Slot[] = [];
  for (let cursor = start; cursor + clinic.slotMin <= end; cursor += clinic.slotMin) {
    const slotEnd = cursor + clinic.slotMin;
    if (hasBreak && overlaps(cursor, slotEnd, breakStart, breakEnd)) continue;
    slots.push({ startTime: minutesToTime(cursor), endTime: minutesToTime(slotEnd) });
  }
  return slots;
}

export function isOccupyingStatus(status: AppointmentStatus): boolean {
  return OCCUPYING_STATUSES.has(status);
}

/** The one, precise cutoff rule for "has this slot's booking window
 *  already closed?" — used identically everywhere a slot's time (not its
 *  booked/free state, which is a separate axis) decides whether it can
 *  still be offered: the patient-facing grid, the re-check right before
 *  confirming, and the client-side mirror of the same rule bookSlot()
 *  enforces before ever writing. A slot is bookable only while its own
 *  start is still strictly in the future — the exact instant `now` reaches
 *  a slot's start, that slot is treated as already begun, not "about to
 *  begin" (this is a deliberate boundary choice, not an accident: 18:00 is
 *  no longer offered once the clock reads 18:00:00, only while it still
 *  reads something earlier). `now` must be an absolute epoch-ms instant —
 *  see lib/time/timeService.ts — compared against the slot's own start
 *  converted through the clinic's own timezone (lib/time/clinicTime.ts),
 *  never the two clock strings compared as plain text, since "6:00" vs
 *  "18:00" and cross-midnight dates both need real instant arithmetic to
 *  get right. */
export function isSlotBookable(
  clinic: Pick<ClinicDoc, "workStart" | "workEnd" | "slotMin" | "breakStart" | "breakEnd"> & { timezone?: string | null },
  dateISO: string,
  startTime: string,
  nowMillis: number
): boolean {
  const slotStartMillis = zonedTimeToUtcMillis(dateISO, startTime, getClinicTimezone(clinic));
  return slotStartMillis > nowMillis;
}

/** generateDaySlots(), narrowed to the slots that are still bookable right
 *  now — i.e. today's grid minus whatever has already started or passed.
 *  A slot that's simply already taken by another booking is a *different*
 *  axis (see isOccupyingStatus()/getSlotAvailability() in firestore.ts)
 *  and isn't this function's concern at all. */
export function filterBookableSlots(
  clinic: Pick<ClinicDoc, "workStart" | "workEnd" | "slotMin" | "breakStart" | "breakEnd"> & { timezone?: string | null },
  dateISO: string,
  slots: Slot[],
  nowMillis: number
): Slot[] {
  return slots.filter((s) => isSlotBookable(clinic, dateISO, s.startTime, nowMillis));
}

export class SlotNotAvailableError extends Error {
  constructor(startTime: string) {
    super(`Slot ${startTime} is not part of this clinic's working hours or falls in a break.`);
    this.name = "SlotNotAvailableError";
  }
}

/** Validates a requested startTime is actually on the clinic's grid and
 *  returns its endTime. Used inside bookSlot()'s transaction so a client
 *  can't book an out-of-hours time by crafting the request directly. */
export function resolveSlotEndTime(
  clinic: Pick<ClinicDoc, "workStart" | "workEnd" | "slotMin" | "breakStart" | "breakEnd">,
  startTime: string
): string {
  const slot = generateDaySlots(clinic).find((s) => s.startTime === startTime);
  if (!slot) throw new SlotNotAvailableError(startTime);
  return slot.endTime;
}
