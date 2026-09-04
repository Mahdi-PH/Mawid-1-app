"use client";

// "طلباتي" — a patient's own pending/past requests across every clinic,
// keyed off the stable anonymous uid Firebase Auth persists in this
// browser (see ensurePatientSession()). No login, no server-side session:
// this is just "whichever appointments carry my own anonymous uid",
// exactly what firestore.rules already scopes appointment reads to for a
// non-clinic, non-admin visitor.
import { useEffect, useState } from "react";
import BackButton from "../../../components/BackButton";
import AppBackdrop from "../../../components/AppBackdrop";
import ConfirmPopup from "../../../components/ConfirmPopup";
import PatientAccountBar from "../../../components/PatientAccountBar";
import { ensurePatientSession } from "../../../lib/firebase/auth";
import { deleteAppointment, listAppointmentsForPatient } from "../../../lib/firebase/firestore";
import type { AppointmentDoc, AppointmentStatus } from "../../../lib/firebase/types";
import { clearActiveBooking, getActiveBooking, getPatientProfile, type PatientProfile } from "../../../lib/patientLocal";

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  requested: "بانتظار تأكيد العيادة",
  booked: "مؤكَّد",
  arrived: "وصلت",
  in_progress: "عند الطبيب",
  completed: "انتهى",
  no_show: "غياب",
  cancelled: "ملغي",
};

export default function MyRequestsPage() {
  const [appts, setAppts] = useState<AppointmentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setProfile(getPatientProfile());
  }, []);

  useEffect(() => {
    ensurePatientSession()
      .then((user) => listAppointmentsForPatient(user.uid))
      .then(setAppts)
      .finally(() => setLoading(false));
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
      <BackButton fallbackHref="/find" label="رجوع للبحث" />
      {profile && <div className="mt-3"><PatientAccountBar profile={profile} /></div>}
      <h1 className="mb-6 mt-3 text-xl font-bold" style={{ color: "#0F7A6C" }}>
        طلباتي
      </h1>

      {loading && <p className="text-gray-500">جارٍ التحميل…</p>}
      {!loading && appts.length === 0 && (
        <p className="text-gray-400">
          لا توجد طلبات بعد. هذه القائمة خاصة بهذا الجهاز/المتصفح فقط — إن غيّرته لن تظهر هنا.
        </p>
      )}

      {deleteError && <p className="mb-3 text-sm text-red-600">{deleteError}</p>}

      <div className="space-y-3">
        {appts.map((a) => (
          <div key={a.id} className="rounded-xl border bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="font-bold">{a.clinicSlug}</span>
              <span className="text-sm text-brand-600">{STATUS_LABEL[a.status]}</span>
            </div>
            <div className="text-sm text-gray-500">
              {a.date} — {a.startTime}
            </div>
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
