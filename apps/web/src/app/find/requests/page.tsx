"use client";

// "حجوزاتي" (renamed from "طلباتي" — this is now the one central place a
// patient reaches every booking they've ever made, not just pending
// requests) across every clinic, keyed off the stable anonymous uid
// Firebase Auth persists in this browser (see ensurePatientSession(), and
// its own comment on why that persistence used to silently break this
// exact list on a reload). No login, no server-side session: this is
// just "whichever appointments carry my own anonymous uid", exactly what
// firestore.rules already scopes appointment reads to for a non-clinic,
// non-admin visitor — Firestore itself is the durable source of truth
// here, not localStorage, so a booking never depends on this device's
// browser storage surviving to still show up.
import Link from "next/link";
import { useEffect, useState } from "react";
import BackButton from "../../../components/BackButton";
import AppBackdrop from "../../../components/AppBackdrop";
import ConfirmPopup from "../../../components/ConfirmPopup";
import PatientSettingsDrawer from "../../../components/PatientSettingsDrawer";
import { ensurePatientSession } from "../../../lib/firebase/auth";
import { deleteAppointment, listAppointmentsForPatient } from "../../../lib/firebase/firestore";
// Reused, not re-declared: this file used to keep its own near-duplicate
// status-label map — one shared source (also used by /clinic and
// /find/wait) means a status can never read differently in two places.
import { STATUS_LABEL } from "../../../lib/firebase/statusMeta";
import type { AppointmentDoc } from "../../../lib/firebase/types";
import { clearActiveBooking, getActiveBooking, getPatientProfile, type PatientProfile } from "../../../lib/patientLocal";

type LoadState = "loading" | "success" | "error";

export default function MyRequestsPage() {
  const [appts, setAppts] = useState<AppointmentDoc[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setProfile(getPatientProfile());
  }, []);

  function load() {
    setLoadState("loading");
    setLoadError(null);
    ensurePatientSession()
      .then((user) => listAppointmentsForPatient(user.uid))
      .then((rows) => {
        setAppts(rows);
        setLoadState("success");
      })
      // Real bug fixed here: a failed fetch (a network hiccup, an
      // auth-session hiccup) used to still fall through to the same
      // "لا توجد حجوزات بعد" text a genuinely empty list shows — telling
      // a patient with real bookings that they have none, rather than
      // that loading them just failed. ERROR and EMPTY are now two
      // different, distinguishable states.
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoadState("error");
      });
  }

  useEffect(() => {
    load();
  }, []);

  // The "يدوياً" half of "حذف الحجز تلقائياً أو يدوياً" — a finished
  // appointment can be deleted from this list at any time, not only via
  // the automatic end-of-visit prompt on /find or /find/wait.
  async function handleDelete(apptId: string) {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAppointment(apptId);
      setAppts((prev) => prev.filter((a) => a.id !== apptId));
      if (getActiveBooking()?.apptId === apptId) clearActiveBooking();
      setConfirmingDeleteId(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main dir="rtl" className="relative min-h-screen mx-auto max-w-2xl p-6">
      <AppBackdrop />
      <div className="relative">
      {profile && <PatientSettingsDrawer profile={profile} />}
      <div className="pl-11">
        <BackButton fallbackHref="/find" label="رجوع للبحث" alwaysUseFallback />
      </div>
      <h1 className="mb-6 mt-3 text-xl font-bold" style={{ color: "#00ADB5" }}>
        حجوزاتي
      </h1>

      {loadState === "loading" && <p className="text-gray-500">جارٍ التحميل…</p>}

      {/* ERROR and EMPTY are deliberately two different messages, not one
       *  — a failed fetch used to fall through to the same "no bookings"
       *  text a genuinely empty list shows, telling a patient with real
       *  bookings that they have none. */}
      {loadState === "error" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="mb-2">تعذّر تحميل حجوزاتك — تحقّق من الاتصال بالإنترنت.{loadError ? ` (${loadError})` : ""}</p>
          <button onClick={load} className="font-bold text-red-800 hover:underline">
            إعادة المحاولة
          </button>
        </div>
      )}

      {loadState === "success" && appts.length === 0 && (
        <p className="text-gray-400">
          لا توجد حجوزات بعد. هذه القائمة خاصة بهذا الجهاز/المتصفح فقط — إن غيّرته لن تظهر هنا.
        </p>
      )}

      {deleteError && <p className="mb-3 text-sm text-red-600">{deleteError}</p>}

      {loadState === "success" && (
        <div className="space-y-3">
          {appts.map((a) => (
            <div key={a.id} className="rounded-xl border bg-white p-4">
              <Link
                href={`/find/wait?clinic=${encodeURIComponent(a.clinicSlug)}&appt=${encodeURIComponent(a.id)}`}
                className="block"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold">{a.clinicSlug}</span>
                  <span className="text-sm text-brand-600">{STATUS_LABEL[a.status]}</span>
                </div>
                <div className="text-sm text-gray-500">
                  {a.date} — {a.startTime}
                </div>
              </Link>
              {a.status === "completed" && (
                <button
                  onClick={() => setConfirmingDeleteId(a.id)}
                  className="mt-2 text-xs text-red-600 hover:underline"
                >
                  حذف الحجز
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      </div>

      <ConfirmPopup
        open={confirmingDeleteId !== null}
        title="حذف هذا الحجز نهائياً؟"
        message="لن تتمكن من التراجع عن هذا الإجراء."
        confirmLabel="حذف"
        busy={deleting}
        onConfirm={() => confirmingDeleteId && handleDelete(confirmingDeleteId)}
        onCancel={() => setConfirmingDeleteId(null)}
      />
    </main>
  );
}
