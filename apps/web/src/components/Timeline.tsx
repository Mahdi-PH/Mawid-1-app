"use client";

import { APPOINTMENT_STATUS_LABELS_AR, type AppointmentStatus } from "@mawid/shared";
import type { DaySlotView } from "../lib/api/client";
import { StatusBadge } from "./StatusBadge";

const STATUS_OPTIONS: AppointmentStatus[] = [
  "booked",
  "arrived",
  "in_progress",
  "completed",
  "no_show",
  "cancelled",
];

interface Props {
  slots: DaySlotView[];
  onEmptySlotClick: (startTime: string) => void;
  onStatusChange: (appointmentId: string, status: AppointmentStatus) => void;
}

/** The core reception screen: one row per bookable slot, color-coded by status. */
export function Timeline({ slots, onEmptySlotClick, onStatusChange }: Props) {
  if (slots.length === 0) {
    return <p className="p-6 text-center text-neutral-500">لا توجد أوقات عمل لهذا اليوم لهذا الطبيب.</p>;
  }

  return (
    <div className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 bg-white">
      {slots.map((slot) => {
        const appt = slot.appointment;
        return (
          <div key={slot.startTime} className="flex items-center gap-4 px-4 py-3">
            <span className="w-16 shrink-0 font-mono text-sm text-neutral-500">{slot.startTime}</span>

            {!appt ? (
              <button
                onClick={() => onEmptySlotClick(slot.startTime)}
                className="flex-1 rounded-lg border border-dashed border-neutral-300 py-2 text-right text-sm text-neutral-400 hover:border-brand-400 hover:bg-brand-50 hover:text-brand-600"
              >
                + حجز موعد
              </button>
            ) : (
              <div className="flex flex-1 items-center justify-between gap-3 rounded-lg bg-neutral-50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-400">#{appt.queueNumber}</span>
                  <span className="font-medium text-neutral-800">{appt.patient.fullName}</span>
                  <StatusBadge status={appt.status} />
                </div>
                <select
                  value={appt.status}
                  onChange={(e) => onStatusChange(appt.id, e.target.value as AppointmentStatus)}
                  className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {APPOINTMENT_STATUS_LABELS_AR[s]}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
