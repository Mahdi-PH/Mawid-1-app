"use client";

// Forced dynamic (no static prerendering) via admin/layout.tsx.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  adminDeleteClinicAccount,
  adminGetStats,
  adminListApprovedClinics,
  adminListPendingClinics,
  adminListRejectedClinics,
  adminListUsers,
  adminRenewSubscription,
  adminSetClinicStatus,
  subscriptionDaysLeft,
} from "../../lib/firebase/firestore";
import type { ClinicDoc, UserDoc } from "../../lib/firebase/types";

// "الكل" has no numeric threshold, so it's kept out of the number-keyed
// filter options below and handled as its own branch in the filter.
const DAYS_LEFT_FILTERS = [
  { key: "all", label: "الكل" },
  { key: "expired", label: "منتهي" },
  { key: "7", label: "أقل من 7 أيام" },
  { key: "30", label: "أقل من 30 يوماً" },
] as const;
type DaysLeftFilter = (typeof DAYS_LEFT_FILTERS)[number]["key"];

function formatDate(ts: UserDoc["createdAt"]): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("ar", { year: "numeric", month: "short", day: "numeric" });
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<{ userCount: number; appointmentCount: number } | null>(null);
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [pending, setPending] = useState<ClinicDoc[]>([]);
  const [approved, setApproved] = useState<ClinicDoc[]>([]);
  const [rejected, setRejected] = useState<ClinicDoc[]>([]);
  const [daysLeftFilter, setDaysLeftFilter] = useState<DaysLeftFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<{ url: string; alt: string } | null>(null);

  async function reload() {
    const [s, u, p, a, r] = await Promise.all([
      adminGetStats(),
      adminListUsers(),
      adminListPendingClinics(),
      adminListApprovedClinics(),
      adminListRejectedClinics(),
    ]);
    setStats(s);
    setUsers(u);
    setPending(p);
    setApproved(a);
    setRejected(r);
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

  async function handleRenew(slug: string) {
    setBusySlug(slug);
    try {
      await adminRenewSubscription(slug);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusySlug(null);
    }
  }

  async function handleDelete(clinic: ClinicDoc) {
    if (
      !window.confirm(
        `حذف حساب "${clinic.clinicName}" (${clinic.email}) نهائياً؟ هذا الإجراء لا يمكن التراجع عنه.`
      )
    ) {
      return;
    }
    setBusySlug(clinic.slug);
    try {
      await adminDeleteClinicAccount(clinic);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusySlug(null);
    }
  }

  if (loading) return <p className="text-gray-500">جارٍ التحميل…</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  const filteredApproved = approved
    .filter((c) => {
      const left = subscriptionDaysLeft(c);
      if (daysLeftFilter === "all") return true;
      if (daysLeftFilter === "expired") return left === null || left < 0;
      return left !== null && left >= 0 && left < Number(daysLeftFilter);
    })
    .sort((a, b) => (subscriptionDaysLeft(a) ?? -Infinity) - (subscriptionDaysLeft(b) ?? -Infinity));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="إجمالي المستخدمين" value={stats?.userCount ?? 0} />
        <StatCard label="إجمالي الحجوزات" value={stats?.appointmentCount ?? 0} />
        <StatCard label="طلبات بانتظار المراجعة" value={pending.length} />
        <StatCard label="حسابات مرفوضة" value={rejected.length} />
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
                  <button
                    onClick={() => handleDelete(c)}
                    disabled={busySlug === c.slug}
                    className="rounded-lg px-3 py-1.5 text-sm text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
                    title="حذف الحساب نهائياً"
                  >
                    حذف
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <span className="font-bold">اشتراكات العيادات</span>
          <div className="flex flex-wrap gap-1">
            {DAYS_LEFT_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setDaysLeftFilter(f.key)}
                className={
                  "rounded-lg px-3 py-1 text-xs font-bold " +
                  (daysLeftFilter === f.key ? "bg-brand-500 text-white" : "text-gray-600 hover:bg-gray-100")
                }
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {filteredApproved.length === 0 ? (
          <p className="px-4 py-6 text-center text-gray-400">لا توجد عيادات مطابقة.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-right text-gray-500">
                <th className="px-4 py-2 font-medium">العيادة</th>
                <th className="px-4 py-2 font-medium">تنتهي في</th>
                <th className="px-4 py-2 font-medium">الوقت المتبقي</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filteredApproved.map((c) => {
                const left = subscriptionDaysLeft(c);
                const expired = left === null || left < 0;
                return (
                  <tr key={c.slug} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      <div className="font-bold">{c.clinicName}</div>
                      <div className="text-xs text-gray-400" dir="ltr">
                        {c.email}
                      </div>
                    </td>
                    <td className="px-4 py-2">{c.subscriptionEndsAt ? formatDate(c.subscriptionEndsAt) : "—"}</td>
                    <td className={"px-4 py-2 font-bold " + (expired ? "text-red-600" : left! <= 1 ? "text-amber-600" : "text-gray-700")}>
                      {expired ? "منتهي" : left === 1 ? "يوم واحد" : `${left} يوماً`}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRenew(c.slug)}
                          disabled={busySlug === c.slug}
                          className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
                        >
                          تجديد شهر
                        </button>
                        <button
                          onClick={() => handleDelete(c)}
                          disabled={busySlug === c.slug}
                          className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-bold text-red-600 disabled:opacity-60"
                        >
                          حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border bg-white">
        <div className="border-b px-4 py-3 font-bold">الحسابات المرفوضة</div>
        {rejected.length === 0 ? (
          <p className="px-4 py-6 text-center text-gray-400">لا توجد حسابات مرفوضة.</p>
        ) : (
          <ul className="divide-y">
            {rejected.map((c) => (
              <li key={c.slug} className="flex flex-wrap items-center gap-4 px-4 py-3">
                <div className="min-w-[10rem] flex-1">
                  <div className="font-bold">{c.clinicName}</div>
                  <div className="text-sm text-gray-500" dir="ltr">
                    {c.email}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(c)}
                  disabled={busySlug === c.slug}
                  className="rounded-lg border border-red-300 px-4 py-1.5 text-sm font-bold text-red-600 disabled:opacity-60"
                >
                  حذف نهائياً
                </button>
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
                  <Link href={`/admin/user?uid=${u.uid}`} className="text-brand-600 hover:underline">
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
