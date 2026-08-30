// Shared domain types used by both the server (apps/server) and the
// reception/TV clients (apps/web). Keeping one source of truth here means
// the offline (IndexedDB) schema and the API payloads never drift apart.

export * from "./slotEngine";

export type UUID = string;

/** Lifecycle of a single appointment slot. Order matters for the UI color map. */
export type AppointmentStatus =
  | "booked" // حجز مؤكد، المريض لم يصل بعد
  | "arrived" // المريض وصل ويجلس في الانتظار
  | "in_progress" // المريض داخل عند الطبيب الآن
  | "completed" // انتهت الزيارة
  | "cancelled" // ألغي الحجز
  | "no_show"; // المريض لم يحضر ولم يلغِ

export const APPOINTMENT_STATUS_LABELS_AR: Record<AppointmentStatus, string> = {
  booked: "محجوز",
  arrived: "في الانتظار",
  in_progress: "عند الطبيب",
  completed: "تم الانتهاء",
  cancelled: "ملغي",
  no_show: "غائب",
};

/** Tailwind color tokens driving the status badge / timeline block color. */
export const APPOINTMENT_STATUS_COLORS: Record<AppointmentStatus, string> = {
  booked: "bg-slate-200 text-slate-800 border-slate-300",
  arrived: "bg-amber-100 text-amber-800 border-amber-300",
  in_progress: "bg-blue-100 text-blue-800 border-blue-300",
  completed: "bg-emerald-100 text-emerald-800 border-emerald-300",
  cancelled: "bg-rose-100 text-rose-800 border-rose-300 line-through",
  no_show: "bg-neutral-200 text-neutral-500 border-neutral-300 line-through",
};

export interface WorkingHoursBlock {
  /** 0 = Sunday ... 6 = Saturday (matches JS Date#getDay) */
  weekday: number;
  startTime: string; // "09:00"
  endTime: string; // "17:00"
}

export interface BreakBlock {
  weekday: number;
  startTime: string; // "13:00"
  endTime: string; // "14:00"
  label?: string | null; // "صلاة/غداء"
}

export interface Clinic {
  id: UUID;
  name: string;
  phone?: string;
  address?: string;
  createdAt: string;
}

export interface Doctor {
  id: UUID;
  clinicId: UUID;
  fullName: string;
  specialty?: string;
  /** Length of one bookable slot, in minutes. Drives the whole slot grid. */
  slotDurationMinutes: number;
  workingHours: WorkingHoursBlock[];
  breaks: BreakBlock[];
  active: boolean;
}

export interface Patient {
  id: UUID;
  clinicId: UUID;
  fullName: string;
  phone: string;
  /** Optional national ID / file number used by reception to find repeat patients fast. */
  patientCode?: string;
  notes?: string;
  createdAt: string;
  /** Present when the record was created offline before it synced to the server. */
  localId?: string;
}

export interface Appointment {
  id: UUID;
  clinicId: UUID;
  doctorId: UUID;
  patientId: UUID;
  date: string; // "2026-08-30"
  startTime: string; // "09:15"
  endTime: string; // "09:30"
  status: AppointmentStatus;
  /** Sequential number for the day, shown on the waiting-room TV instead of a name. */
  queueNumber: number;
  notes?: string;
  reminderSentAt?: string | null;
  createdAt: string;
  updatedAt: string;
  localId?: string;
}

export interface Visit {
  id: UUID;
  appointmentId: UUID;
  patientId: UUID;
  doctorId: UUID;
  diagnosisNote?: string;
  prescriptionText?: string;
  createdAt: string;
  localId?: string;
}

// ---------------------------------------------------------------------------
// Offline sync queue (mirrors apps/web/src/lib/offline/db.ts SyncQueue table)
// ---------------------------------------------------------------------------

export type SyncEntity = "patient" | "appointment" | "visit";
export type SyncOpType = "create" | "update";

export interface SyncOperation {
  /** Client-generated id (uuid), stable across retries so the server can dedupe. */
  opId: string;
  entity: SyncEntity;
  opType: SyncOpType;
  entityLocalId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
}

export interface SyncPushResult {
  opId: string;
  status: "applied" | "duplicate" | "rejected";
  /** Server-assigned id, so the client can remap its localId references. */
  serverId?: string;
  reason?: string;
}
