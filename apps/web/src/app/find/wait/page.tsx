"use client";

// The patient's own "شاشة الانتظار" — opens as a SECOND window right after
// booking (see the "افتح شاشة الانتظار" button in find/book/page.tsx),
// alongside the booking window itself. Deliberately scoped to the
// patient's own appointment only, not the clinic's full queue: a public
// "who's currently being seen" screen would need firestore.rules to let
// any visitor list a clinic's appointments for today, which would also
// hand over every other patient's name/phone on that list — the same
// tradeoff getSlotAvailability() already avoids for the booking grid (see
// its own comment). Live-updating via watchAppointment()'s onSnapshot, so
// the patient sees the clinic mark them "arrived"/"in_progress" in real
// time with no manual refresh.
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import BackButton from "../../../components/BackButton";
import AppBackdrop from "../../../components/AppBackdrop";
import { ensurePatientSession } from "../../../lib/firebase/auth";
import { getClinic, watchAppointment } from "../../../lib/firebase/firestore";
import { STATUS_COLOR, STATUS_LABEL, STATUS_PATIENT_MESSAGE } from "../../../lib/firebase/statusMeta";
import type { AppointmentDoc, ClinicDoc } from "../../../lib/firebase/types";

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
  const params = useSearchParams();
  const apptId = params.get("appt") ?? "";
  const clinicSlug = params.get("clinic") ?? "";

  const [clinic, setClinic] = useState<ClinicDoc | null>(null);
  const [appt, setAppt] = useState<AppointmentDoc | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    if (clinicSlug) getClinic(clinicSlug).then(setClinic);
  }, [clinicSlug]);

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

        <h1 className="mt-3 text-xl font-bold" style={{ color: "#0F7A6C" }}>
          {clinic?.clinicName ?? appt.clinicSlug}
        </h1>
        <p className="mb-8 text-sm text-gray-500">موعدك اليوم الساعة {appt.startTime}</p>

        <div
          className={"mx-auto flex w-full flex-col items-center gap-3 rounded-2xl border-2 p-8 " + STATUS_COLOR[appt.status]}
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

        <p className="mt-6 text-xs text-gray-400">تُحدَّث هذه الشاشة تلقائياً — لا حاجة لإعادة تحميل الصفحة.</p>
      </div>
    </main>
  );
}
