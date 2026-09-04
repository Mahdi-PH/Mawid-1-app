"use client";

// The patient's own live "شاشة الانتظار" — reached from the clinic's own
// landing menu (find/book/page.tsx's "شاشة الانتظار" button, once a
// booking exists) rather than being a standalone destination. Shows the
// clinic name, the patient's own name, their live status, and their
// queue standing ("دورك رقم N" / how many are still ahead) — the last two
// come from clinic_queue_slots (see lib/firebase/queue.ts), a separate,
// PII-free per-clinic-per-day board any signed-in patient may read, kept
// in sync with the real appointments data by bookSlot()/
// setAppointmentStatus() so this page never needs to query other
// patients' actual appointment docs (those stay scoped to their own
// owner/clinic, unchanged). Both the appointment's own status
// (watchAppointment) and the queue board (watchClinicQueue) are live
// onSnapshot subscriptions, so the clinic's reception dashboard driving
// someone through arrived/in_progress/completed updates this screen with
// no manual refresh.
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BackButton from "../../../components/BackButton";
import AppBackdrop from "../../../components/AppBackdrop";
import ConfirmPopup from "../../../components/ConfirmPopup";
import PatientAccountBar from "../../../components/PatientAccountBar";
import { ensurePatientSession } from "../../../lib/firebase/auth";
import { deleteAppointment, getClinic, watchAppointment } from "../../../lib/firebase/firestore";
import { computeQueueStanding, watchClinicQueue } from "../../../lib/firebase/queue";
import { STATUS_COLOR, STATUS_LABEL, STATUS_PATIENT_MESSAGE } from "../../../lib/firebase/statusMeta";
import type { AppointmentDoc, ClinicDoc, ClinicQueueSlotDoc } from "../../../lib/firebase/types";
import {
  clearActiveBooking,
  getActiveBooking,
  getPatientProfile,
  isEndPromptDismissed,
  markEndPromptDismissed,
  type PatientProfile,
} from "../../../lib/patientLocal";

const TERMINAL_STATUSES = new Set(["completed", "cancelled", "no_show"]);

export default function WaitPage() {
  return (
    <Suspense
      fallback={
        <div className="relative min-h-screen">
          <AppBackdrop />
          <p className="relative p-6 text-gray-500">جارٍ التحميل…</p>
        </div>
      }
    >
      <Wait />
    </Suspense>
  );
}

function Wait() {
  const router = useRouter();
  const params = useSearchParams();
  const apptId = params.get("appt") ?? "";
  const clinicSlug = params.get("clinic") ?? "";

  const [clinic, setClinic] = useState<ClinicDoc | null>(null);
  const [appt, setAppt] = useState<AppointmentDoc | null | undefined>(undefined); // undefined = loading
  const [queueSlots, setQueueSlots] = useState<ClinicQueueSlotDoc[]>([]);
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [showEndPrompt, setShowEndPrompt] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setProfile(getPatientProfile());
  }, []);

  useEffect(() => {
    if (clinicSlug) getClinic(clinicSlug).then(setClinic);
  }, [clinicSlug]);

  // Once the visit is over, this is no longer "your current booking" —
  // stop offering it as the fast way back in from /find.
  useEffect(() => {
    if (!appt || !TERMINAL_STATUSES.has(appt.status)) return;
    const active = getActiveBooking();
    if (active?.apptId === appt.id) clearActiveBooking();
  }, [appt]);

  // "انتهى موعدك، هل تريد حذف الحجز؟" — the moment the clinic marks this
  // appointment "completed" (live, via the onSnapshot listener below this
  // page already has), offer to delete it. Only asks once per appointment
  // — "لا، إبقاء السجل" records the choice via markEndPromptDismissed() so
  // a later visit to this same finished appointment doesn't ask again.
  useEffect(() => {
    if (!appt || appt.status !== "completed") return;
    if (isEndPromptDismissed(appt.id)) return;
    setShowEndPrompt(true);
  }, [appt]);

  async function handleDeleteBooking() {
    if (!appt) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAppointment(appt.id);
      clearActiveBooking();
      markEndPromptDismissed(appt.id);
      router.push("/find");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  function handleKeepBooking() {
    if (appt) markEndPromptDismissed(appt.id);
    setShowEndPrompt(false);
  }

  // "رقم دورك" / "أمامك N مراجع" — the live queue board, one cheap query
  // (not one read per possible slot the way the old capacity check was),
  // updating in real time as the clinic moves other patients through
  // arrived/in_progress/completed on its own reception dashboard. See
  // lib/firebase/queue.ts for why this board can carry no PII and still
  // be safely readable by any signed-in patient.
  useEffect(() => {
    if (!appt) return;
    return watchClinicQueue(appt.clinicSlug, appt.date, setQueueSlots);
  }, [appt]);

  const standing = appt ? computeQueueStanding(queueSlots, appt.startTime) : null;
  const estimatedWaitMin = standing ? standing.aheadCount * (clinic?.slotMin ?? 15) : null;

  useEffect(() => {
    if (!apptId) {
      setAppt(null);
      return;
    }
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    // Opening this page in a fresh tab relies on Firebase Auth's persisted
    // anonymous session from the booking tab already being on hand — but
    // that rehydration is itself async, so make sure it's resolved (not
    // just assumed present) before subscribing, the same guard bookSlot()
    // gets via ensurePatientSession() on the booking page.
    ensurePatientSession().finally(() => {
      if (!cancelled) unsubscribe = watchAppointment(apptId, setAppt);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [apptId]);

  if (!apptId || appt === null) {
    return (
      <main dir="rtl" className="relative min-h-screen mx-auto max-w-md p-6 text-center">
        <AppBackdrop />
        <div className="relative">
          <p className="text-red-600">تعذّر العثور على هذا الحجز.</p>
          <BackButton fallbackHref="/find" label="رجوع للبحث" className="mt-4 inline-block text-brand-600 hover:underline" />
        </div>
      </main>
    );
  }

  if (appt === undefined) {
    return (
      <div className="relative min-h-screen">
        <AppBackdrop />
        <p className="relative p-6 text-gray-500">جارٍ التحميل…</p>
      </div>
    );
  }

  const isCurrent = appt.status === "in_progress";

  return (
    <main dir="rtl" className="relative min-h-screen mx-auto max-w-md p-6 text-center">
      <AppBackdrop />
      <div className="relative">
        <BackButton fallbackHref="/find" label="رجوع للبحث" />

        {profile && <div className="mt-3"><PatientAccountBar profile={profile} /></div>}

        <h1 className="mt-3 text-xl font-bold" style={{ color: "#0F7A6C" }}>
          {clinic?.clinicName ?? appt.clinicSlug}
        </h1>
        <p className="mb-1 text-sm text-gray-500">
          {appt.patientName} — موعدك اليوم الساعة {appt.startTime}
        </p>

        <div
          className={"mx-auto mt-6 flex w-full flex-col items-center gap-3 rounded-2xl border-2 p-8 " + STATUS_COLOR[appt.status]}
        >
          {isCurrent && (
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-blue-600" />
            </span>
          )}
          <div className="text-3xl font-extrabold">{STATUS_LABEL[appt.status]}</div>
          <p className="text-sm">{STATUS_PATIENT_MESSAGE[appt.status]}</p>
        </div>

        {standing && (
          <div className="mx-auto mt-6 grid w-full grid-cols-2 gap-3">
            <div className="rounded-xl border bg-white p-4">
              <div className="text-xs text-gray-400">دورك رقم</div>
              <div className="text-2xl font-extrabold" style={{ color: "#0F7A6C" }}>
                {standing.position}
              </div>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <div className="text-xs text-gray-400">أمامك</div>
              <div className="text-2xl font-extrabold" style={{ color: "#0F7A6C" }}>
                {standing.aheadCount}
              </div>
              <div className="text-xs text-gray-400">مراجع</div>
            </div>
            {estimatedWaitMin !== null && (
              <div className="col-span-2 rounded-xl border bg-white p-4 text-sm text-gray-500">
                الوقت المتوقع للانتظار: <span className="font-bold text-gray-700">~{estimatedWaitMin} دقيقة</span>
              </div>
            )}
          </div>
        )}

        <p className="mt-6 text-xs text-gray-400">تُحدَّث هذه الشاشة تلقائياً — لا حاجة لإعادة تحميل الصفحة.</p>
        {deleteError && <p className="mt-3 text-sm text-red-600">{deleteError}</p>}
      </div>

      <ConfirmPopup
        open={showEndPrompt}
        title="انتهى موعدك، هل تريد حذف الحجز؟"
        confirmLabel="نعم، حذف الحجز"
        cancelLabel="لا، إبقاء السجل"
        busy={deleting}
        onConfirm={handleDeleteBooking}
        onCancel={handleKeepBooking}
      />
    </main>
  );
}
