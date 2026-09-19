"use client";

// The patient-facing Notification Center — persisted in Firestore, not the
// OS-level Notification API (see lib/notifications.ts for that separate,
// clinic-side, non-persistent foreground alert — a different system with a
// deliberately similar-sounding name; do not confuse the two).
//
// Centralized creation, per the request's own explicit architecture ask:
// every notification is written from exactly ONE function
// (createStatusNotification(), below), called only from the two places in
// firestore.ts that already change an appointment's real status —
// bookSlot() (the "تم إرسال طلبك" notification, status "requested") and
// setAppointmentStatus() (every clinic-driven transition after that). No
// UI component ever writes a notification directly. This mirrors
// lib/firebase/queue.ts's own syncQueueSlot()/watchClinicQueue() shape
// (best-effort write function + live watch function) — the same
// established pattern for "a live, denormalized, best-effort mirror of the
// real appointment data," just surfaced to the patient instead of the
// clinic's own queue board.
//
// Deliberately scoped to appointment-status events only, not incremental
// queue-position changes ("أنت الآن رقم 3", "اقترب دورك") — those aren't a
// discrete write anywhere in this app; they're a client-side computation
// (computeQueueStanding() in queue.ts) re-run every time ANY appointment at
// a clinic changes, for EVERY other waiting patient at once. There is no
// existing single event to hook for "this specific patient's position
// changed," and inventing one would mean writing into every other waiting
// patient's notification list on every single status change at a clinic —
// real, unbounded write amplification for a feature that wasn't the
// literal request ("لا تخترع منطقاً جديداً... استخدم البيانات الموجودة
// فعلياً"). The one queue-adjacent event patients actually care about most
// — "حان دورك الآن" — already IS a real, single, per-patient status
// transition ("in_progress"), and is fully covered here.
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "./config";
import { NOTIFICATION_TITLE, STATUS_PATIENT_MESSAGE } from "./statusMeta";
import type { AppNotificationDoc, AppointmentStatus } from "./types";

/** Best-effort — own try/catch, never throws, same convention as
 *  syncQueueSlot(): a failure here can never fail the real booking/status
 *  write it's called alongside, since the notification center is a live
 *  convenience view, not the source of truth (that stays the appointment
 *  doc itself, unchanged). A plain setDoc overwrite, same idempotent-write
 *  shape syncQueueSlot() itself uses — the deterministic id means a retried
 *  call for the same real transition writes identical content, not a
 *  duplicate notification. */
export function createStatusNotification(
  appointmentId: string,
  clinicSlug: string,
  patientUid: string,
  status: AppointmentStatus
): void {
  const id = `${appointmentId}_${status}`;
  const data: Omit<AppNotificationDoc, "createdAt"> & { createdAt: unknown } = {
    id,
    patientUid,
    status,
    title: NOTIFICATION_TITLE[status],
    body: STATUS_PATIENT_MESSAGE[status],
    clinicSlug,
    appointmentId,
    isRead: false,
    createdAt: serverTimestamp(),
  };
  setDoc(doc(db, "notifications", id), data).catch((err) => {
    console.error("createStatusNotification failed (non-fatal, notification center may miss this event):", err);
  });
}

/** No orderBy in the query — a single equality filter needs no composite
 *  index, matching this project's own hard-learned convention (see
 *  adminListPendingClinics()/listAppointmentsForPatient() in firestore.ts,
 *  both hit undeployed-index failures for exactly this shape of query
 *  before being fixed the same way): sorted client-side instead. */
export function watchNotifications(
  patientUid: string,
  onChange: (notifications: AppNotificationDoc[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const q = query(collection(db, "notifications"), where("patientUid", "==", patientUid));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => d.data() as AppNotificationDoc);
      rows.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      onChange(rows);
    },
    (err) => {
      onError?.(err);
      onChange([]);
    }
  );
}

export function unreadNotificationCount(notifications: AppNotificationDoc[]): number {
  return notifications.filter((n) => !n.isRead).length;
}

export async function markNotificationRead(id: string): Promise<void> {
  await updateDoc(doc(db, "notifications", id), { isRead: true });
}

/** Batched (one commit, not N updateDoc calls) — only touches the actually-
 *  unread rows, so calling this with nothing unread is a cheap no-op. */
export async function markAllNotificationsRead(notifications: AppNotificationDoc[]): Promise<void> {
  const unread = notifications.filter((n) => !n.isRead);
  if (unread.length === 0) return;
  const batch = writeBatch(db);
  unread.forEach((n) => batch.update(doc(db, "notifications", n.id), { isRead: true }));
  await batch.commit();
}
