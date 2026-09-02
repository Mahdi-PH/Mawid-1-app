"use client";

// Forced dynamic (no static prerendering) via admin/layout.tsx.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  adminGetStats,
  adminListPendingClinics,
  adminListUsers,
  adminSetClinicStatus,
} from "../../lib/firebase/firestore";
import type { ClinicDoc, UserDoc } from "../../lib/firebase/types";

function formatDate(ts: UserDoc["createdAt"]): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("ar", { year: "numeric", month: "short", day: "numeric" });
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<{ userCount: number; appointmentCount: number } | null>(null);
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [pending, setPending] = useState<ClinicDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<{ url: string; alt: string } | null>(null);

  async function reload() {
    const [s, u, p] = await Promise.all([adminGetStats(), adminListUsers(), adminListPendingClinics()]);
    setStats(s);
    setUsers(u);
    setPending(p);
  }

  useEffect(() => {
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function handleDecision(slug: string, status: "approved" | "rejected") {
    setBusySlug(slug);
    try {
      await adminSetClinicStatus(slug, status);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusySlug(null);
    }
  }

  if (loading) return <p className="text-gray-500">جارٍ التحميل…</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="إجمالي المستخدمين" value={stats?.userCount ?? 0} />
        <StatCard label="إجمالي الحجوزات" value={stats?.appointmentCount ?? 0} />
        <StatCard label="طلبات بانتظار المراجعة" value={pending.length} />
      </div>

      {zoomedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setZoomedImage(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoomedImage.url} alt={zoomedImage.alt} className="max-h-full max-w-full rounded-lg" />
        </div>
      )}

      <div className="rounded-xl border bg-white">
        <div className="border-b px-4 py-3 font-bold">طلبات التسجيل المعلَّقة</div>
        {pending.length === 0 ? (
          <p className="px-4 py-6 text-center text-gray-400">لا توجد طلبات معلَّقة حالياً.</p>
        ) : (
          <ul className="divide-y">
            {/* licenseImageUrl is a data: URL (see lib/firebase/licenseImage.ts),
                not an https:// link — Chrome blocks top-level navigation to
                data: URLs (an anti-phishing measure), so an <a target="_blank">
                here would silently do nothing on click. A same-page zoom
                overlay works for any URL scheme and needs no navigation. */}
            {pending.map((c) => (
              <li key={c.slug} className="flex flex-wrap items-center gap-4 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setZoomedImage({ url: c.licenseImageUrl, alt: `إجازة ${c.clinicName}` })}
                  className="shrink-0"
                  title="عرض صورة الإجازة بالحجم الكامل"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.licenseImageUrl}
                    alt={`إجازة ${c.clinicName}`}
                    className="h-16 w-16 rounded-lg border object-cover"
                  />
                </button>
                <div className="min-w-[10rem] flex-1">
                  <div className="font-bold">{c.clinicName}</div>
                  <div className="text-sm text-gray-500" dir="ltr">
                    {c.email}
                  </div>
                  <div className="text-xs text-gray-400">رابط الحجز: /{c.slug}</div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDecision(c.slug, "approved")}
                    disabled={busySlug === c.slug}
                    className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-bold text-white disabled:opacity-60"
                  >
                    موافقة
                  </button>
                  <button
                    onClick={() => handleDecision(c.slug, "rejected")}
                    disabled={busySlug === c.slug}
                    className="rounded-lg border border-red-300 px-4 py-1.5 text-sm font-bold text-red-600 disabled:opacity-60"
                  >
                    رفض
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border bg-white">
        <div className="border-b px-4 py-3 font-bold">المستخدمون المسجَّلون</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-right text-gray-500">
              <th className="px-4 py-2 font-medium">الاسم</th>
              <th className="px-4 py-2 font-medium">البريد الإلكتروني</th>
              <th className="px-4 py-2 font-medium">الدور</th>
              <th className="px-4 py-2 font-medium">تاريخ التسجيل</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.uid} className="border-b last:border-0">
                <td className="px-4 py-2">{u.displayName}</td>
                <td className="px-4 py-2 text-gray-600" dir="ltr">
                  {u.email}
                </td>
                <td className="px-4 py-2">{u.role === "admin" ? "مدير" : "عيادة"}</td>
                <td className="px-4 py-2">{formatDate(u.createdAt)}</td>
                <td className="px-4 py-2">
                  <Link href={`/admin/users/${u.uid}`} className="text-brand-600 hover:underline">
                    التفاصيل ›
                  </Link>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  لا يوجد مستخدمون بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-2xl font-bold text-brand-700">{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
    </div>
  );
}
