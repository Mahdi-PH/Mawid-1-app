// One shared color/label map for AppointmentStatus, used by both the
// clinic's own reception dashboard (/clinic) and the patient-facing
// waiting screen (/find/wait) so a status never reads differently in two
// places. Same bg/text/border Tailwind convention as @mawid/shared's
// APPOINTMENT_STATUS_COLORS (the Postgres/apps/server track's own status
// badge, see components/StatusBadge.tsx) — extended with "requested",
// a Firestore-only status the Postgres model has no equivalent for.
import type { AppointmentStatus } from "./types";

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  requested: "بانتظار تأكيد",
  booked: "مؤكَّد",
  arrived: "وصل",
  in_progress: "عند الطبيب",
  completed: "انتهى",
  no_show: "غياب",
  cancelled: "ملغي",
};

export const STATUS_COLOR: Record<AppointmentStatus, string> = {
  requested: "bg-purple-100 text-purple-800 border-purple-300",
  booked: "bg-slate-200 text-slate-800 border-slate-300",
  arrived: "bg-amber-100 text-amber-800 border-amber-300",
  in_progress: "bg-blue-100 text-blue-800 border-blue-300",
  completed: "bg-emerald-100 text-emerald-800 border-emerald-300",
  cancelled: "bg-rose-100 text-rose-800 border-rose-300 line-through",
  no_show: "bg-neutral-200 text-neutral-500 border-neutral-300 line-through",
};

/** Solid dot color (matches STATUS_COLOR's hue) for the small indicator
 *  next to the reception table's status select. */
export const STATUS_DOT: Record<AppointmentStatus, string> = {
  requested: "#9333EA",
  booked: "#475569",
  arrived: "#D97706",
  in_progress: "#2563EB",
  completed: "#059669",
  cancelled: "#E11D48",
  no_show: "#737373",
};

export const STATUS_PATIENT_MESSAGE: Record<AppointmentStatus, string> = {
  requested: "طلبك قيد المراجعة من العيادة، سيتم تأكيده قريباً.",
  booked: "تم تأكيد موعدك — الرجاء الحضور في الوقت المحدد.",
  arrived: "تم تسجيل وصولك، أنت الآن ضمن قائمة الانتظار.",
  in_progress: "حان دورك الآن — تفضّل عند الطبيب.",
  completed: "انتهت زيارتك. نتمنى لك دوام الصحة.",
  no_show: "تم تسجيلك كغياب لهذا الموعد.",
  cancelled: "تم إلغاء هذا الموعد.",
};
