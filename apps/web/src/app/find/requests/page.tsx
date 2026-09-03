"use client";

// "طلباتي" — a patient's own pending/past requests across every clinic,
// keyed off the stable anonymous uid Firebase Auth persists in this
// browser (see ensurePatientSession()). No login, no server-side session:
// this is just "whichever appointments carry my own anonymous uid",
// exactly what firestore.rules already scopes appointment reads to for a
// non-clinic, non-admin visitor.
import { useEffect, useState } from "react";
import BackButton from "../../../components/BackButton";
import { ensurePatientSession } from "../../../lib/firebase/auth";
import { listAppointmentsForPatient } from "../../../lib/firebase/firestore";
import type { AppointmentDoc, AppointmentStatus } from "../../../lib/firebase/types";

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

  useEffect(() => {
    ensurePatientSession()
      .then((user) => listAppointmentsForPatient(user.uid))
      .then(setAppts)
      .finally(() => setLoading(false));
  }, []);

  return (
    <main dir="rtl" className="mx-auto max-w-2xl p-6">
      <BackButton fallbackHref="/find" label="رجوع للبحث" />
      <h1 className="mb-6 mt-3 text-xl font-bold" style={{ color: "#0F7A6C" }}>
        طلباتي
      </h1>

      {loading && <p className="text-gray-500">جارٍ التحميل…</p>}
      {!loading && appts.length === 0 && (
        <p className="text-gray-400">
          لا توجد طلبات بعد. هذه القائمة خاصة بهذا الجهاز/المتصفح فقط — إن غيّرته لن تظهر هنا.
        </p>
      )}

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
          </div>
        ))}
      </div>
    </main>
  );
}
