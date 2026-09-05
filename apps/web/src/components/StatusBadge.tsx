import { APPOINTMENT_STATUS_COLORS, APPOINTMENT_STATUS_LABELS_AR, type AppointmentStatus } from "@mawid/shared";

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${APPOINTMENT_STATUS_COLORS[status]}`}
    >
      {APPOINTMENT_STATUS_LABELS_AR[status]}
    </span>
  );
}
