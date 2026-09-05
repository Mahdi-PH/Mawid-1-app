import { STATUS_COLOR, STATUS_LABEL } from "../lib/firebase/statusMeta";
import type { AppointmentStatus } from "../lib/firebase/types";

export default function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
