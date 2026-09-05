"use client";

// The clinic reception dashboard. Restructured per the user's explicit
// ask: only الاستقبال (reception) and شاشة الانتظار (waiting-room TV) stay
// as top-level tabs for daily work — مسح سجل المراجع، إعدادات الدوام، and
// خطة الاشتراك moved into a single "إعدادات الحساب" drawer opened from a
// gear icon pinned to the screen's physical top-left corner (see
// components/ClinicAccountDrawer.tsx), sign-out included at its bottom.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import BackButton from "../../components/BackButton";
import AppBackdrop from "../../components/AppBackdrop";
import ClinicAccountDrawer from "../../components/ClinicAccountDrawer";
import { auth } from "../../lib/firebase/config";
import {
  isSubscriptionActive,
  setAppointmentStatus,
  subscriptionDaysLeft,
  SUBSCRIPTION_WARNING_DAYS,
  watchAppointmentsForClinic,
  watchClinicByOwner,
} from "../../lib/firebase/firestore";
import { generateDaySlots } from "../../lib/firebase/slotEngine";
import { STATUS_DOT, STATUS_LABEL } from "../../lib/firebase/statusMeta";
import { OCCUPYING_STATUSES } from "../../lib/firebase/types";
import type { AppointmentDoc, AppointmentStatus, ClinicDoc, ClinicStatus } from "../../lib/firebase/types";
import {
  canRequestNotificationPermission,
  notificationPermission,
  notifyClinicStatusChange,
  requestNotificationPermission,
} from "../../lib/notifications";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

type Tab = "reception" | "tv";

export default function ClinicDashboardPage() {
  const [clinic, setClinic] = useState<ClinicDoc | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("reception");
  const [appts, setAppts] = useState<AppointmentDoc[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const prevStatusRef = useRef<ClinicStatus | undefined>(undefined);

  // Live, not a one-shot fetch: an admin approving/rejecting the clinic
  // (or renewing its subscription) now reflects on this already-open
  // dashboard immediately — and is what actually lets the notification
  // below fire the instant it happens rather than only on the next visit.
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    return watchClinicByOwner(uid, (c) => {
      if (prevStatusRef.current === "pending" && c && c.status !== "pending") {
        notifyClinicStatusChange(c.status === "approved" ? "approved" : "rejected", c.clinicName);
      }
      prevStatusRef.current = c?.status;
      setClinic(c);
    });
  }, []);

  // Live too — a new patient booking, or this same clinic's own status
  // write, shows up with no manual reload either way.
  useEffect(() => {
    if (!clinic) return;
    return watchAppointmentsForClinic(clinic.slug, todayISO(), setAppts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.slug]);

  if (clinic === undefined) {
    return (
      <div className="relative min-h-screen">
        <AppBackdrop />
        <p className="relative p-8 text-center text-gray-500">جارٍ التحميل…</p>
      </div>
    );
  }
  if (clinic === null) {
    return (
      <div className="relative min-h-screen">
        <AppBackdrop />
        <div className="relative p-8 text-center">
          <BackButton
            fallbackHref="/"
            alwaysUseFallback
            className="mb-4 inline-block text-sm text-brand-600 hover:underline"
          />
          <p className="text-red-600">هذا الحساب لا يملك عيادة مسجَّلة. سجّل عيادتك أولاً عبر صفحة التسجيل.</p>
        </div>
      </div>
    );
  }
  if (clinic.status !== "approved") {
    // The "pending" case is the account's own pending-approval screen —
    // gets a real, prominent "رجوع إلى الواجهة الرئيسية" button (not just
    // the subtle top-of-page link every other screen gets), per the
    // user's explicit ask for exactly this on the pending-approval screen.
    return (
      <div className="relative min-h-screen">
        <AppBackdrop />
        <div className="relative mx-auto max-w-sm p-8 text-center">
          <h1 className="mb-2 text-lg font-bold" style={{ color: "#0F7A6C" }}>
            {clinic.clinicName}
          </h1>
          <p className="mb-6 text-gray-600">
            {clinic.status === "pending"
              ? "طلب تسجيلك قيد المراجعة من قبل الإدارة — سيتفعّل حسابك بعد الموافقة على الإجازة المرفوعة."
              : "تعذّر تفعيل هذا الحساب. تواصل مع الإدارة لمزيد من التفاصيل."}
          </p>
          {clinic.status === "pending" && <NotificationOptIn />}
          <Link
            href="/"
            className="inline-block w-full rounded-lg bg-brand-500 py-3 text-center font-bold text-white hover:bg-brand-600"
          >
            العودة إلى الواجهة الرئيسية
          </Link>
        </div>
      </div>
    );
  }

  // Approved but the (real, once-a-month) subscription has run out — the
  // account is fully closed until admin manually renews it (see
  // /admin's "تجديد شهر" button; there's no real payment gateway, so
  // renewal is always this human confirmation step after the clinic pays
  // via the account number shown in "خطة الاشتراك" in the settings drawer).
  if (!isSubscriptionActive(clinic)) {
    return (
      <div className="relative min-h-screen">
        <AppBackdrop />
        <div className="relative mx-auto max-w-sm p-8 text-center">
          <h1 className="mb-2 text-lg font-bold" style={{ color: "#0F7A6C" }}>
            {clinic.clinicName}
          </h1>
          <p className="mb-6 text-red-600">انتهى اشتراكك الشهري وتم إغلاق الحساب مؤقتاً. تواصل مع الإدارة لتجديد الاشتراك.</p>
          <Link
            href="/"
            className="inline-block w-full rounded-lg bg-brand-500 py-3 text-center font-bold text-white hover:bg-brand-600"
          >
            العودة إلى الواجهة الرئيسية
          </Link>
        </div>
      </div>
    );
  }

  const daysLeft = subscriptionDaysLeft(clinic);
  const showExpiryWarning = daysLeft !== null && daysLeft <= SUBSCRIPTION_WARNING_DAYS;

  const bookingLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/find/book?clinic=${encodeURIComponent(clinic.slug)}`
      : "";

  return (
    <div className="relative min-h-screen bg-gray-50">
      <AppBackdrop />
      <header className="sticky top-0 z-10 border-b bg-white px-6 py-3">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="إعدادات الحساب"
          className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
        >
          <GearIcon />
        </button>

        <div className="pl-11">
          <BackButton fallbackHref="/" alwaysUseFallback className="mb-2 block text-sm text-brand-600 hover:underline" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-bold" style={{ color: "#0F7A6C" }}>
              {clinic.clinicName}
            </h1>
            <div className="flex items-center gap-2 text-sm">
              <input
                readOnly
                value={bookingLink}
                dir="ltr"
                className="w-64 rounded-lg border bg-gray-50 px-2 py-1 text-xs text-gray-500"
              />
              <button
                onClick={() => navigator.clipboard?.writeText(bookingLink)}
                className="rounded-lg border px-3 py-1 hover:bg-gray-50"
              >
                نسخ
              </button>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            {(
              [
                ["reception", "الاستقبال"],
                ["tv", "شاشة الانتظار"],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={
                  "rounded-lg px-4 py-2 text-sm font-bold " +
                  (tab === id ? "bg-brand-500 text-white" : "text-gray-600 hover:bg-gray-100")
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {showExpiryWarning && (
        <div className="relative bg-amber-50 px-6 py-2 text-center text-sm text-amber-800">
          {daysLeft !== null && daysLeft > 0
            ? `ينتهي اشتراكك خلال ${daysLeft === 1 ? "يوم واحد" : `${daysLeft} أيام`} — جدّد الآن لتفادي إغلاق الحساب.`
            : "اشتراكك ينتهي اليوم — جدّد الآن لتفادي إغلاق الحساب."}
        </div>
      )}

      <main className="relative p-6">
        {tab === "reception" && <ReceptionTab clinic={clinic} appts={appts} />}
        {tab === "tv" && <WaitingRoomTv appts={appts} />}
      </main>

      <ClinicAccountDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} clinic={clinic} onScheduleSaved={setClinic} />
    </div>
  );
}

/** Opt-in — never auto-prompts for permission with no context, which
 *  browsers increasingly block anyway. Only shown on the pending-approval
 *  screen, since that's the one moment "علم المركز فوراً" actually
 *  matters. Disclosed in its own confirmation line once granted: this
 *  only works while this tab/app is open, not after it's fully closed —
 *  see lib/notifications.ts for why. */
function NotificationOptIn() {
  const [permission, setPermission] = useState<NotificationPermission | null>(null);

  useEffect(() => {
    setPermission(notificationPermission());
  }, []);

  if (!canRequestNotificationPermission() || permission === "denied") return null;

  if (permission === "granted") {
    return (
      <p className="mb-4 text-xs text-green-700">
        ✓ سيصلك تنبيه فور تغيّر حالة حسابك، طالما هذه الصفحة مفتوحة على جهازك.
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={async () => setPermission(await requestNotificationPermission())}
      className="mb-4 w-full rounded-lg border border-brand-300 px-4 py-2 text-sm text-brand-700 hover:bg-brand-50"
      style={{ borderColor: "#0F7A6C", color: "#0F7A6C" }}
    >
      🔔 فعّل التنبيهات لإعلامك فور الموافقة
    </button>
  );
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function ReceptionTab({ clinic, appts }: { clinic: ClinicDoc; appts: AppointmentDoc[] }) {
  const slots = generateDaySlots(clinic);
  const byTime = new Map(appts.map((a) => [a.startTime, a]));

  async function handleStatusChange(appt: AppointmentDoc, status: AppointmentStatus) {
    await setAppointmentStatus(appt, status);
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-right text-gray-500">
            <th className="px-4 py-2 font-medium">الوقت</th>
            <th className="px-4 py-2 font-medium">المريض</th>
            <th className="px-4 py-2 font-medium">الحالة</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => {
            const a = byTime.get(s.startTime);
            return (
              <tr key={s.startTime} className="border-b last:border-0">
                <td className="px-4 py-2 font-mono">{s.startTime}</td>
                <td className="px-4 py-2">
                  {a ? (
                    <>
                      {a.patientName}
                      <div className="text-xs text-gray-400" dir="ltr">
                        {a.patientPhone}
                      </div>
                    </>
                  ) : (
                    <span className="text-gray-300">متاح</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {a ? (
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-block h-2.5 w-2.5 flex-none rounded-full"
                        style={{ backgroundColor: STATUS_DOT[a.status] }}
                        title={STATUS_LABEL[a.status]}
                      />
                      <select
                        value={a.status}
                        onChange={(e) => handleStatusChange(a, e.target.value as AppointmentStatus)}
                        className="rounded border px-2 py-1"
                        style={{ borderInlineStartWidth: 3, borderInlineStartColor: STATUS_DOT[a.status] }}
                      >
                        {(Object.keys(STATUS_LABEL) as AppointmentStatus[]).map((st) => (
                          <option key={st} value={st}>
                            {STATUS_LABEL[st]}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WaitingRoomTv({ appts }: { appts: AppointmentDoc[] }) {
  const queue = appts
    .filter((a) => OCCUPYING_STATUSES.has(a.status) && a.status !== "completed")
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const current = queue.find((a) => a.status === "in_progress");
  const waiting = queue.filter((a) => a.status !== "in_progress");

  return (
    <div dir="rtl" className="mx-auto max-w-3xl text-center">
      <div className="mb-8 rounded-2xl border-4 p-10" style={{ borderColor: "#0F7A6C" }}>
        <div className="mb-2 text-sm text-gray-500">الحالي عند الطبيب</div>
        <div className="text-5xl font-bold" style={{ color: "#0F7A6C" }}>
          {current ? current.patientName : "—"}
        </div>
        {current && <div className="mt-2 text-gray-400">{current.startTime}</div>}
      </div>

      <div className="mb-3 text-lg font-bold">قائمة الانتظار ({waiting.length})</div>
      <div className="space-y-2">
        {waiting.map((a, i) => (
          <div key={a.id} className="flex items-center justify-between rounded-xl border bg-white p-4">
            <span className="text-2xl font-bold text-gray-300">{i + 1}</span>
            <span className="font-bold">{a.patientName}</span>
            <span className="font-mono text-gray-400">{a.startTime}</span>
          </div>
        ))}
        {waiting.length === 0 && <p className="text-gray-400">لا يوجد مراجعون بالانتظار حالياً.</p>}
      </div>
    </div>
  );
}
