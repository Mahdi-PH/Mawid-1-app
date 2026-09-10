import { describe, expect, it } from "vitest";
import {
  buildSlotLockKey,
  generateDaySlots,
  getAvailableSlots,
  resolveSlotEndTime,
  SlotNotAvailableError,
  timeToMinutes,
  minutesToTime,
} from "./slotEngine";

// 2026-08-30 is a Sunday (weekday 0).
const SUNDAY = "2026-08-30";

const doctor = {
  slotDurationMinutes: 15,
  workingHours: [{ weekday: 0, startTime: "09:00", endTime: "12:00" }],
  breaks: [{ weekday: 0, startTime: "10:00", endTime: "10:15", label: "استراحة" }],
};

describe("time helpers", () => {
  it("round-trips minutes <-> time", () => {
    expect(timeToMinutes("09:05")).toBe(545);
    expect(minutesToTime(545)).toBe("09:05");
  });
});

describe("generateDaySlots", () => {
  it("splits working hours into fixed 15-minute slots", () => {
    const slots = generateDaySlots(doctor, SUNDAY);
    // 09:00-12:00 = 180 minutes / 15 = 12 slots, minus 1 break slot (10:00-10:15) = 11
    expect(slots).toHaveLength(11);
    expect(slots[0]).toEqual({ startTime: "09:00", endTime: "09:15" });
    expect(slots.at(-1)).toEqual({ startTime: "11:45", endTime: "12:00" });
  });

  it("excludes any slot overlapping a break", () => {
    const slots = generateDaySlots(doctor, SUNDAY);
    expect(slots.find((s) => s.startTime === "10:00")).toBeUndefined();
  });

  it("returns nothing for a weekday with no working-hours block", () => {
    // 2026-08-29 is Saturday (weekday 6) - clinic closed per this config.
    expect(generateDaySlots(doctor, "2026-08-29")).toEqual([]);
  });
});

describe("getAvailableSlots", () => {
  it("hides slots already occupied by a non-cancelled appointment", () => {
    const available = getAvailableSlots(doctor, SUNDAY, [
      { startTime: "09:00", status: "booked" },
      { startTime: "09:15", status: "arrived" },
    ]);
    expect(available.find((s) => s.startTime === "09:00")).toBeUndefined();
    expect(available.find((s) => s.startTime === "09:15")).toBeUndefined();
    expect(available.find((s) => s.startTime === "09:30")).toBeDefined();
  });

  it("frees a slot again once its appointment is cancelled", () => {
    const available = getAvailableSlots(doctor, SUNDAY, [
      { startTime: "09:00", status: "cancelled" },
    ]);
    expect(available.find((s) => s.startTime === "09:00")).toBeDefined();
  });
});

describe("buildSlotLockKey (DB double-booking guard)", () => {
  it("produces the same key for the same doctor/date/time regardless of status, as long as occupying", () => {
    const a = buildSlotLockKey("doc1", SUNDAY, "09:00", "booked");
    const b = buildSlotLockKey("doc1", SUNDAY, "09:00", "arrived");
    expect(a).toBe(b);
    expect(a).toBe("doc1|2026-08-30|09:00");
  });

  it("returns null for a cancelled appointment so the unique index doesn't block rebooking", () => {
    expect(buildSlotLockKey("doc1", SUNDAY, "09:00", "cancelled")).toBeNull();
  });
});

describe("resolveSlotEndTime", () => {
  it("returns the grid end time for a valid slot", () => {
    expect(resolveSlotEndTime(doctor, SUNDAY, "09:30")).toBe("09:45");
  });

  it("throws SlotNotAvailableError for a time that falls inside a break", () => {
    expect(() => resolveSlotEndTime(doctor, SUNDAY, "10:00")).toThrow(SlotNotAvailableError);
  });

  it("throws SlotNotAvailableError for a time outside working hours", () => {
    expect(() => resolveSlotEndTime(doctor, SUNDAY, "13:00")).toThrow(SlotNotAvailableError);
  });
});
