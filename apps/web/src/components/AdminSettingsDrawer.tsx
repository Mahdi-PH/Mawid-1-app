"use client";

// "إعدادات لوحة التحكم" — every admin sub-section that used to sit
// directly on /admin (طلبات التسجيل المعلَّقة، الاشتراكات، الحسابات
// المرفوضة، المستخدمون المسجَّلون) now lives here instead, opened from a
// gear icon pinned at admin/layout.tsx's own header corner — the same
// slide-over pattern as components/ClinicAccountDrawer.tsx. Unlike that
// drawer, there's no single parent-owned entity to receive as a prop, so
// this one owns its own data loading; app/admin/page.tsx (now a pure
// stats dashboard) is notified of changes made here via adminRefreshBus,
// since the two are siblings under the same layout, not parent/child.
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  adminDeleteClinicAccount,
  adminListApprovedClinics,
  adminListPendingClinics,
  adminListRejectedClinics,
  adminListUsers,
  adminRenewSubscription,
  adminSetClinicStatus,
  subscriptionDaysLeft,
} from "../lib/firebase/firestore";
import { notifyAdminDataChanged } from "../lib/adminRefreshBus";
import type { ClinicDoc, UserDoc } from "../lib/firebase/types";

type Tool = "pending" | "rejected" | "subscriptions" | "users";

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: "pending", label: "طلبات التسجيل المعلَّقة", icon: "📝" },
  { id: "rejected", label: "الحسابات المرفوضة", icon: "🚫" },
  { id: "subscriptions", label: "الاشتراكات", icon: "💳" },
  { id: "users", label: "المستخدمون المسجَّلون", icon: "👥" },
];

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

export default function AdminSettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const [pending, setPending] = useState<ClinicDoc[]>([]);
  const [approved, setApproved] = useState<ClinicDoc[]>([]);
  const [rejected, setRejected] = useState<ClinicDoc[]>([]);
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [daysLeftFilter, setDaysLeftFilter] = useState<DaysLeftFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<{ url: string; alt: string } | null>(null);

  async function reload() {
    const [p, a, r, u] = await Promise.all([
      adminListPendingClinics(),
      adminListApprovedClinics(),
      adminListRejectedClinics(),
      adminListUsers(),
    ]);
    setPending(p);
    setApproved(a);
    setRejected(r);
    setUsers(u);
  }

  useEffect(() => {
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDecision(slug: string, status: "approved" | "rejected") {
    setBusySlug(slug);
    try {
      await adminSetClinicStatus(slug, status);
      await reload();
      notifyAdminDataChanged();
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
      notifyAdminDataChanged();
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
      notifyAdminDataChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusySlug(null);
    }
  }

  if (!open) return null;

  function handleClose() {
    setActiveTool(null);
    onClose();
  }

  const filteredApproved = approved
    .filter((c) => {
      const left = subscriptionDaysLeft(c);
      if (daysLeftFilter === "all") return true;
      if (daysLeftFilter === "expired") return left === null || left < 0;
      return left !== null && left >= 0 && left < Number(daysLeftFilter);
    })
    .sort((a, b) => (subscriptionDaysLeft(a) ?? -Infinity) - (subscriptionDaysLeft(b) ?? -Infinity));

  const toolCount: Record<Tool, number> = {
    pending: pending.length,
    rejected: rejected.length,
    subscriptions: approved.length,
    users: users.length,
  };
  const toolLabel = TOOLS.find((t) => t.id === activeTool)?.label;

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={handleClose} />
      <div
        dir="rtl"
        className="absolute left-0 top-0 flex h-full w-full max-w-lg flex-col shadow-2xl"
        style={{ background: "linear-gradient(180deg, #F5FBF9 0%, #FFFFFF 220px)" }}
      >
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
          <h2 className="text-lg font-extrabold" style={{ color: "#0F7A6C" }}>
            {activeTool ? toolLabel : "إعدادات لوحة التحكم"}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="إغلاق"
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-black/5"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <p className="text-center text-gray-400">جارٍ التحميل…</p>
          ) : error ? (
            <p className="text-center text-red-600">{error}</p>
          ) : activeTool === null ? (
            <div className="space-y-2">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTool(t.id)}
                  className="flex w-full items-center gap-3 rounded-xl bg-white px-3 py-3 text-right shadow-sm ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <span
                    aria-hidden
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-base"
                    style={{ backgroundColor: "#EAF6F3", color: "#0F7A6C" }}
                  >
                    {t.icon}
                  </span>
                  <span className="font-bold text-gray-800">{t.label}</span>
                  <span className="mr-auto text-xs font-bold text-gray-400">{toolCount[t.id]}</span>
                  <span className="text-gray-300">‹</span>
                </button>
              ))}
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => setActiveTool(null)}
                className="mb-4 text-sm font-bold hover:underline"
                style={{ color: "#0F7A6C" }}
              >
                ‹ رجوع
              </button>
              {activeTool === "pending" && (
                <PendingSection
                  pending={pending}
                  busySlug={busySlug}
                  onDecide={handleDecision}
                  onDelete={handleDelete}
                  zoomedImage={zoomedImage}
                  setZoomedImage={setZoomedImage}
                />
              )}
              {activeTool === "rejected" && (
                <RejectedSection rejected={rejected} busySlug={busySlug} onDelete={handleDelete} />
              )}
              {activeTool === "subscriptions" && (
                <SubscriptionsSection
                  approved={filteredApproved}
                  daysLeftFilter={daysLeftFilter}
                  setDaysLeftFilter={setDaysLeftFilter}
                  busySlug={busySlug}
                  onRenew={handleRenew}
                  onDelete={handleDelete}
                />
              )}
              {activeTool === "users" && <UsersSection users={users} onNavigate={handleClose} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PendingSection({
  pending,
  busySlug,
  onDecide,
  onDelete,
  zoomedImage,
  setZoomedImage,
}: {
  pending: ClinicDoc[];
  busySlug: string | null;
  onDecide: (slug: string, status: "approved" | "rejected") => void;
  onDelete: (clinic: ClinicDoc) => void;
  zoomedImage: { url: string; alt: string } | null;
  setZoomedImage: (v: { url: string; alt: string } | null) => void;
}) {
  return (
    <div>
      {/* licenseImageUrl is a data: URL (see lib/firebase/licenseImage.ts),
          not an https:// link — Chrome blocks top-level navigation to
          data: URLs (an anti-phishing measure), so an <a target="_blank">
          here would silently do nothing on click. A same-page zoom
          overlay works for any URL scheme and needs no navigation. */}
      {zoomedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setZoomedImage(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoomedImage.url} alt={zoomedImage.alt} className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
      {pending.length === 0 ? (
        <p className="py-6 text-center text-gray-400">لا توجد طلبات معلَّقة حالياً.</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-white">
          {pending.map((c) => (
            <li key={c.slug} className="flex flex-wrap items-center gap-3 px-4 py-3">
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
                  className="h-14 w-14 rounded-lg border object-cover"
                />
              </button>
              <div className="min-w-[8rem] flex-1">
                <div className="font-bold">{c.clinicName}</div>
                <div className="text-sm text-gray-500" dir="ltr">
                  {c.email}
                </div>
                <div className="text-xs text-gray-400">رابط الحجز: /{c.slug}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => onDecide(c.slug, "approved")}
                  disabled={busySlug === c.slug}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
                >
                  موافقة
                </button>
                <button
                  onClick={() => onDecide(c.slug, "rejected")}
                  disabled={busySlug === c.slug}
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-bold text-red-600 disabled:opacity-60"
                >
                  رفض
                </button>
                <button
                  onClick={() => onDelete(c)}
                  disabled={busySlug === c.slug}
                  className="rounded-lg px-2 py-1.5 text-xs text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
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
  );
}

function RejectedSection({
  rejected,
  busySlug,
  onDelete,
}: {
  rejected: ClinicDoc[];
  busySlug: string | null;
  onDelete: (clinic: ClinicDoc) => void;
}) {
  if (rejected.length === 0) return <p className="py-6 text-center text-gray-400">لا توجد حسابات مرفوضة.</p>;
  return (
    <ul className="divide-y rounded-xl border bg-white">
      {rejected.map((c) => (
        <li key={c.slug} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-[8rem] flex-1">
            <div className="font-bold">{c.clinicName}</div>
            <div className="text-sm text-gray-500" dir="ltr">
              {c.email}
            </div>
          </div>
          <button
            onClick={() => onDelete(c)}
            disabled={busySlug === c.slug}
            className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-bold text-red-600 disabled:opacity-60"
          >
            حذف نهائياً
          </button>
        </li>
      ))}
    </ul>
  );
}

function SubscriptionsSection({
  approved,
  daysLeftFilter,
  setDaysLeftFilter,
  busySlug,
  onRenew,
  onDelete,
}: {
  approved: ClinicDoc[];
  daysLeftFilter: DaysLeftFilter;
  setDaysLeftFilter: (f: DaysLeftFilter) => void;
  busySlug: string | null;
  onRenew: (slug: string) => void;
  onDelete: (clinic: ClinicDoc) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1">
        {DAYS_LEFT_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setDaysLeftFilter(f.key)}
            className={
              "rounded-lg px-3 py-1 text-xs font-bold " +
              (daysLeftFilter === f.key
                ? "bg-brand-500 text-white"
                : "bg-white text-gray-600 ring-1 ring-black/5 hover:bg-gray-100")
            }
          >
            {f.label}
          </button>
        ))}
      </div>
      {approved.length === 0 ? (
        <p className="py-6 text-center text-gray-400">لا توجد عيادات مطابقة.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-right text-gray-500">
                <th className="px-3 py-2 font-medium">العيادة</th>
                <th className="px-3 py-2 font-medium">تنتهي في</th>
                <th className="px-3 py-2 font-medium">المتبقي</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {approved.map((c) => {
                const left = subscriptionDaysLeft(c);
                const expired = left === null || left < 0;
                return (
                  <tr key={c.slug} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-bold">{c.clinicName}</div>
                      <div className="text-xs text-gray-400" dir="ltr">
                        {c.email}
                      </div>
                    </td>
                    <td className="px-3 py-2">{c.subscriptionEndsAt ? formatDate(c.subscriptionEndsAt) : "—"}</td>
                    <td
                      className={
                        "px-3 py-2 font-bold " +
                        (expired ? "text-red-600" : left! <= 1 ? "text-amber-600" : "text-gray-700")
                      }
                    >
                      {expired ? "منتهي" : left === 1 ? "يوم واحد" : `${left} يوماً`}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => onRenew(c.slug)}
                          disabled={busySlug === c.slug}
                          className="rounded-lg bg-brand-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-60"
                        >
                          تجديد شهر
                        </button>
                        <button
                          onClick={() => onDelete(c)}
                          disabled={busySlug === c.slug}
                          className="rounded-lg border border-red-300 px-2 py-1 text-xs font-bold text-red-600 disabled:opacity-60"
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
        </div>
      )}
    </div>
  );
}

function UsersSection({ users, onNavigate }: { users: UserDoc[]; onNavigate: () => void }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-right text-gray-500">
            <th className="px-3 py-2 font-medium">الاسم</th>
            <th className="px-3 py-2 font-medium">البريد الإلكتروني</th>
            <th className="px-3 py-2 font-medium">الدور</th>
            <th className="px-3 py-2 font-medium">التسجيل</th>
            <th className="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.uid} className="border-b last:border-0">
              <td className="px-3 py-2">{u.displayName}</td>
              <td className="px-3 py-2 text-gray-600" dir="ltr">
                {u.email}
              </td>
              <td className="px-3 py-2">{u.role === "admin" ? "مدير" : "عيادة"}</td>
              <td className="px-3 py-2">{formatDate(u.createdAt)}</td>
              <td className="px-3 py-2">
                <Link href={`/admin/user?uid=${u.uid}`} onClick={onNavigate} className="text-brand-600 hover:underline">
                  التفاصيل ›
                </Link>
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-gray-400">
                لا يوجد مستخدمون بعد.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
