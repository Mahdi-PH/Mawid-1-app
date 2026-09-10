"use client";

// Query-param route (?uid=...) rather than a dynamic segment
// (/admin/users/[uid]) — a static export (see next.config.js) has to
// enumerate every dynamic-segment path at build time, which is impossible
// here since uids aren't known until runtime. A single always-exported
// page reading the id from the query string sidesteps that entirely.
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  adminGetUser,
  adminListAppointmentsForUser,
  deleteAppointment,
  setAppointmentStatus,
} from "../../../lib/firebase/firestore";
import type { AppointmentDoc, AppointmentStatus, UserDoc } from "../../../lib/firebase/types";

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  requested: "بانتظار تأكيد",
  booked: "محجوز",
  arrived: "في الانتظار",
  in_progress: "عند الطبيب",
  completed: "انتهى",
  no_show: "غياب",
  cancelled: "ملغي",
};

export default function AdminUserDetailPage() {
  // useSearchParams() requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<p className="text-gray-500">جارٍ التحميل…</p>}>
      <AdminUserDetail />
    </Suspense>
  );
}

function AdminUserDetail() {
  const uid = useSearchParams().get("uid") ?? "";
  const [user, setUser] = useState<UserDoc | null>(null);
  const [appts, setAppts] = useState<AppointmentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [u, a] = await Promise.all([adminGetUser(uid), adminListAppointmentsForUser(uid)]);
    setUser(u);
    setAppts(a);
  }

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  async function handleStatusChange(appt: AppointmentDoc, status: AppointmentStatus) {
    await setAppointmentStatus(appt, status);
    await reload();
  }

  async function handleDelete(id: string) {
    if (!confirm("حذف هذا الموعد نهائياً؟")) return;
    await deleteAppointment(id);
    await reload();
  }

  if (!uid) return <p className="text-red-600">لم يُحدَّد مستخدم (رابط ناقص).</p>;
  if (loading) return <p className="text-gray-500">جارٍ التحميل…</p>;
  if (error) return <p className="text-red-600">{error}</p>;
  if (!user) return <p className="text-gray-500">المستخدم غير موجود.</p>;

  return (
    <div className="space-y-6">
      {/* Back navigation for /admin/* is provided once by admin/layout.tsx's
          shared header (BackButton, fallback "/admin") rather than
          duplicated here. */}
      <div className="rounded-xl border bg-white p-4">
        <div className="text-lg font-bold">{user.displayName}</div>
        <div className="text-sm text-gray-500" dir="ltr">
          {user.email}
        </div>
      </div>

      <div className="rounded-xl border bg-white">
        <div className="border-b px-4 py-3 font-bold">المواعيد ({appts.length})</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-right text-gray-500">
              <th className="px-4 py-2 font-medium">التاريخ</th>
              <th className="px-4 py-2 font-medium">الوقت</th>
              <th className="px-4 py-2 font-medium">المريض</th>
              <th className="px-4 py-2 font-medium">الحالة</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {appts.map((a) => (
              <tr key={a.id} className="border-b last:border-0">
                <td className="px-4 py-2">{a.date}</td>
                <td className="px-4 py-2">{a.startTime}</td>
                <td className="px-4 py-2">
                  {a.patientName}
                  <div className="text-xs text-gray-400" dir="ltr">
                    {a.patientPhone}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <select
                    value={a.status}
                    onChange={(e) => handleStatusChange(a, e.target.value as AppointmentStatus)}
                    className="rounded border px-2 py-1"
                  >
                    {(Object.keys(STATUS_LABEL) as AppointmentStatus[]).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <button onClick={() => handleDelete(a.id)} className="text-red-600 hover:underline">
                    حذف
                  </button>
                </td>
              </tr>
            ))}
            {appts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  لا توجد مواعيد لهذا الحساب.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
