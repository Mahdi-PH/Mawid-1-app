"use client";

// Public patient directory - no login, ever (see lib/firebase/auth.ts
// ensurePatientSession(), only called once a visitor actually books).
// Lists only clinics/{slug}.status === "approved" (listApprovedClinics())
// so a still-pending or rejected signup stays invisible here exactly like
// the demo artifact's directoryClinics(), just against real Firestore data
// instead of localStorage. Search matches clinic name + governorate/
// district text, same fields the demo's single search box matches - no
// GPS, per the same product decision already made for the artifact.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ConfirmPopup from "../../components/ConfirmPopup";
import { ensurePatientSession } from "../../lib/firebase/auth";
import { deleteAppointment, listApprovedClinics, watchAppointment } from "../../lib/firebase/firestore";
import type { AppointmentDoc, ClinicDoc } from "../../lib/firebase/types";
import BackButton from "../../components/BackButton";
import AppBackdrop from "../../components/AppBackdrop";
import PatientAccountBar from "../../components/PatientAccountBar";
import PatientGate from "../../components/PatientGate";
import {
  clearActiveBooking,
  getActiveBooking,
  getPatientProfile,
  isEndPromptDismissed,
  markEndPromptDismissed,
  type ActiveBooking,
  type PatientProfile,
} from "../../lib/patientLocal";

const TERMINAL_STATUSES = new Set(["completed", "cancelled", "no_show"]);

export default function FindClinicPage() {
  // undefined = hasn't checked localStorage yet (avoids a flash of the
  // gate before we know a saved profile exists, same reasoning as the
  // home screen's own localStorage-gated splash check).
  const [profile, setProfile] = useState<PatientProfile | null | undefined>(undefined);
  const [activeBooking, setActiveBooking] = useState<ActiveBooking | null>(null);

  useEffect(() => {
    setProfile(getPatientProfile());
    setActiveBooking(getActiveBooking());
  }, []);

  if (profile === undefined) {
    return (
      <div className="relative min-h-screen">
        <AppBackdrop />
      </div>
    );
  }

  if (profile === null) {
    return (
      <PatientGate
        onDone={(p) => {
          setProfile(p);
          setActiveBooking(getActiveBooking());
        }}
      />
    );
  }

  return (
    <FindClinicSearch profile={profile} activeBooking={activeBooking} />
  );
}

function FindClinicSearch({
  profile,
  activeBooking: initialActiveBooking,
}: {
  profile: PatientProfile;
  activeBooking: ActiveBooking | null;
}) {
  const [clinics, setClinics] = useState<ClinicDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [activeBooking, setActiveBooking] = useState(initialActiveBooking);
  const [showEndPrompt, setShowEndPrompt] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    listApprovedClinics()
      .then(setClinics)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Covers the same "انتهى موعدك، هل تريد حذف الحجز؟" prompt as
  // /find/wait, but for a patient who lands back on /find directly
  // (closed the waiting-screen tab, or never opened it) instead of
  // reopening the specific appointment's own page — live via onSnapshot,
  // not a one-time fetch, so it still fires if the clinic finishes the
  // visit while this tab happens to be open.
  useEffect(() => {
    if (!activeBooking) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    ensurePatientSession().finally(() => {
      if (cancelled) return;
      unsubscribe = watchAppointment(activeBooking.apptId, (appt) => {
        if (!appt) {
          // Resolves to null both for a genuinely deleted appointment and
          // for a denied read (see watchAppointment()'s own comment) —
          // either way, "موعدك الحالي" can never point anywhere useful
          // again, so clear it here instead of leaving this card stuck
          // linking to a dead /find/wait page forever.
          clearActiveBooking();
          setActiveBooking(null);
          return;
        }
        if (TERMINAL_STATUSES.has(appt.status)) clearActiveBooking();
        if (appt.status === "completed" && !isEndPromptDismissed(appt.id)) setShowEndPrompt(true);
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [activeBooking]);

  async function handleDeleteBooking() {
    if (!activeBooking) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAppointment(activeBooking.apptId);
      clearActiveBooking();
      markEndPromptDismissed(activeBooking.apptId);
      setActiveBooking(null);
      setShowEndPrompt(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  function handleKeepBooking() {
    if (activeBooking) markEndPromptDismissed(activeBooking.apptId);
    setShowEndPrompt(false);
  }

  const filtered = useMemo(() => {
    const needle = q.trim();
    if (!needle) return clinics;
    return clinics.filter((c) => {
      const haystack = `${c.clinicName} - ${c.district ?? ""} ${c.gov ?? ""}`;
      return haystack.includes(needle);
    });
  }, [clinics, q]);

  return (
    <main dir="rtl" className="relative min-h-screen mx-auto max-w-2xl p-6">
      <AppBackdrop />
      <div className="relative">
      <BackButton fallbackHref="/" className="mb-3 block text-sm text-brand-600 hover:underline" />

      <PatientAccountBar profile={profile} />

      {activeBooking && (
        <Link
          href={`/find/wait?clinic=${encodeURIComponent(activeBooking.clinicSlug)}&appt=${encodeURIComponent(activeBooking.apptId)}`}
          className="mb-6 block rounded-xl border-2 p-4 transition hover:-translate-y-0.5"
          style={{ borderColor: "#0F7A6C", background: "#EEF7F6" }}
        >
          <div className="text-sm text-gray-500">موعدك الحالي</div>
          <div className="font-bold" style={{ color: "#0F7A6C" }}>
            {activeBooking.clinicName} — {activeBooking.startTime}
          </div>
          <div className="mt-1 text-xs text-brand-600">فتح شاشة الانتظار ‹</div>
        </Link>
      )}

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: "#0F7A6C" }}>
          ابحث عن مركزك
        </h1>
        <div className="flex gap-3 text-sm">
          <Link href="/find/passport" className="text-brand-600 hover:underline">
            بطاقتي الصحية
          </Link>
          <Link href="/find/requests" className="text-brand-600 hover:underline">
            طلباتي
          </Link>
        </div>
      </div>

      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ابحث باسم العيادة أو الحي"
        className="mb-6 w-full rounded-lg border px-3 py-2"
      />

      {loading && <p className="text-gray-500">جارٍ التحميل…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <p className="text-gray-400">لا توجد عيادة مطابقة.</p>
      )}

      <div className="space-y-3">
        {filtered.map((c) => (
          <Link
            key={c.slug}
            href={`/find/book?clinic=${encodeURIComponent(c.slug)}`}
            className="block rounded-xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5"
          >
            <div className="font-bold">{c.clinicName}</div>
            <div className="text-sm text-gray-500">
              {c.specialty} · {c.doctorName}
              {c.gov && ` · ${c.gov}${c.district ? " - " + c.district : ""}`}
            </div>
          </Link>
        ))}
      </div>
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
