"use client";

// The live patient-facing queue board — one clinic_queue_slots/{apptId}
// doc per appointment (same deterministic id as its matching
// appointments/{apptId} doc, so no separate id builder is needed —
// getAppointmentId() already gives the right id for both). Deliberately a
// SEPARATE, PII-free document from the real appointment: clinicSlug/date/
// startTime/status only, never patientName/patientPhone, which is what
// lets firestore.rules allow any signed-in patient to read the whole
// day's board (needed to count "how many are ahead of me") without
// exposing anyone else's identity — see firestore.rules' own comment on
// this collection for the write-side ownership rules.
//
// Written from two places, kept in sync with the real appointments data
// they mirror: bookSlot() writes the first "requested" entry right after
// a booking succeeds; setAppointmentStatus() updates it on every status
// change the clinic makes. Both calls are best-effort (see syncQueueSlot)
// — a failure here never blocks the real booking/status-change, since
// this board is a live convenience view, not the source of truth.
import { collection, doc, onSnapshot, query, setDoc, serverTimestamp, where } from "firebase/firestore";
import { db } from "./config";
import type { AppointmentStatus, ClinicQueueSlotDoc } from "./types";

/** Statuses that still count as "ahead of me in line" — a completed/
 *  cancelled/no-show slot is out of the way and shouldn't inflate anyone
 *  else's wait estimate. */
const AHEAD_STATUSES: ReadonlySet<AppointmentStatus> = new Set(["requested", "booked", "arrived", "in_progress"]);

/** Best-effort write — deliberately swallows its own errors (logged, not
 *  thrown) so a hiccup here can never fail the real booking/status-change
 *  it's called alongside. */
export function syncQueueSlot(clinicSlug: string, date: string, startTime: string, status: AppointmentStatus): void {
  const id = `${clinicSlug}_${date}_${startTime}`;
  const data: Omit<ClinicQueueSlotDoc, "updatedAt"> & { updatedAt: unknown } = {
    clinicSlug,
    date,
    startTime,
    status,
    updatedAt: serverTimestamp(),
  };
  setDoc(doc(db, "clinic_queue_slots", id), data).catch((err) => {
    console.error("syncQueueSlot failed (non-fatal, live queue view may lag):", err);
  });
}

/** Live subscription to a clinic's whole queue board for one day — a
 *  single query, not one read per slot, so this scales with "how many
 *  appointments today" rather than "how many possible slots today" the
 *  way the older getSlotAvailability()-based capacity check did. Two
 *  plain equality filters on different fields need no composite index
 *  (same as listAppointmentsForClinic() elsewhere in this file). */
export function watchClinicQueue(
  clinicSlug: string,
  date: string,
  onChange: (slots: ClinicQueueSlotDoc[]) => void
): () => void {
  const q = query(collection(db, "clinic_queue_slots"), where("clinicSlug", "==", clinicSlug), where("date", "==", date));
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => d.data() as ClinicQueueSlotDoc)),
    () => onChange([])
  );
}

export interface QueueStanding {
  /** 1-indexed — "دورك رقم N". */
  position: number;
  /** How many still-active appointments are scheduled earlier today. */
  aheadCount: number;
}

/** Pure — works even if this patient's own queue-slot doc hasn't landed
 *  yet (e.g. syncQueueSlot's write is still in flight), since it only
 *  needs to compare OTHER slots' times against the patient's own known
 *  startTime, not find their own doc in the list. */
export function computeQueueStanding(slots: ClinicQueueSlotDoc[], myStartTime: string): QueueStanding {
  const aheadCount = slots.filter((s) => s.startTime < myStartTime && AHEAD_STATUSES.has(s.status)).length;
  return { position: aheadCount + 1, aheadCount };
}
