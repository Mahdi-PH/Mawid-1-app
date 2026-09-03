"use client";

// The clinic reception dashboard — the missing piece that meant a clinic
// could sign up via /signup, get approved, and then have nowhere real to
// go. Three tabs, matching the demo artifact's view-clinic screen
// exactly: الاستقبال (reception timeline), شاشة الانتظار (waiting-room
// TV), إعدادات الدوام (schedule settings) - reusing firestore.ts
// functions that already existed for this (listAppointmentsForClinic,
// setAppointmentStatus, updateClinicSchedule) with no UI in front of them
// until now, same story as /find.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import BackButton from "../../components/BackButton";
import { auth } from "../../lib/firebase/config";
import {
  getClinicByOwner,
  isSubscriptionActive,
  listAppointmentsForClinic,
  setAppointmentStatus,
  subscriptionDaysLeft,
  SUBSCRIPTION_WARNING_DAYS,
  updateClinicSchedule,
  ScheduleConflictError,
} from "../../lib/firebase/firestore";
import { generateDaySlots } from "../../lib/firebase/slotEngine";
import { OCCUPYING_STATUSES } from "../../lib/firebase/types";
import type { AppointmentDoc, AppointmentStatus, ClinicDoc } from "../../lib/firebase/types";

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  requested: "بانتظار تأكيد",
  booked: "مؤكَّد",
  arrived: "وصل",
  in_progress: "عند الطبيب",
  completed: "انتهى",
  no_show: "غياب",
  cancelled: "ملغي",
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

type Tab = "reception" | "tv" | "settings";

export default function ClinicDashboardPage() {
  const [clinic, setClinic] = useState<ClinicDoc | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("reception");
  const [appts, setAppts] = useState<AppointmentDoc[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reloadAppts = useCallback(async (c: ClinicDoc) => {
    setAppts(await listAppointmentsForClinic(c.slug, todayISO()));
  }, []);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getClinicByOwner(uid).then((c) => {
      setClinic(c);
      if (c) reloadAppts(c);
    });
  }, [reloadAppts]);

  if (clinic === undefined) {
    return <p className="p-8 text-center text-gray-500">جارٍ التحميل…</p>;
  }
  if (clinic === null) {
    return (
      <div className="p-8 text-center">
        <BackButton fallbackHref="/" className="mb-4 inline-block text-sm text-brand-600 hover:underline" />
        <p className="text-red-600">هذا الحساب لا يملك عيادة مسجَّلة. سجّل عيادتك أولاً عبر صفحة التسجيل.</p>
      </div>
    );
  }
  if (clinic.status !== "approved") {
    // The "pending" case is the account's own pending-approval screen —
    // gets a real, prominent "رجوع إلى الواجهة الرئيسية" button (not just
    // the subtle top-of-page link every other screen gets), per the
    // user's explicit ask for exactly this on the pending-approval screen.
    return (
      <div className="mx-auto max-w-sm p-8 text-center">
        <h1 className="mb-2 text-lg font-bold" style={{ color: "#0F7A6C" }}>
          {clinic.clinicName}
        </h1>
        <p className="mb-6 text-gray-600">
          {clinic.status === "pending"
            ? "طلب تسجيلك قيد المراجعة من قبل الإدارة — سيتفعّل حسابك بعد الموافقة على الإجازة المرفوعة."
            : "تعذّر تفعيل هذا الحساب. تواصل مع الإدارة لمزيد من التفاصيل."}
        </p>
        <Link
          href="/"
          className="inline-block w-full rounded-lg bg-brand-500 py-3 text-center font-bold text-white hover:bg-brand-600"
        >
          العودة إلى الواجهة الرئيسية
        </Link>
      </div>
    );
  }

  // Approved but the (real, once-a-month) subscription has run out — the
  // account is fully closed until admin manually renews it (see
  // /admin's "تجديد شهر" button; there's no real payment gateway, so
  // renewal is always this human confirmation step after the clinic pays
  // via the account number shown on /subscribe).
  if (!isSubscriptionActive(clinic)) {
    return (
      <div className="mx-auto max-w-sm p-8 text-center">
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
    );
  }

  const daysLeft = subscriptionDaysLeft(clinic);
  const showExpiryWarning = daysLeft !== null && daysLeft <= SUBSCRIPTION_WARNING_DAYS;

  const bookingLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/find/book?clinic=${encodeURIComponent(clinic.slug)}`
      : "";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b bg-white px-6 py-3">
        <BackButton fallbackHref="/" className="mb-2 block text-sm text-brand-600 hover:underline" />
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
              ["settings", "إعدادات الدوام"],
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
      </header>

      {showExpiryWarning && (
        <div className="bg-amber-50 px-6 py-2 text-center text-sm text-amber-800">
          {daysLeft !== null && daysLeft > 0
            ? `ينتهي اشتراكك خلال ${daysLeft === 1 ? "يوم واحد" : `${daysLeft} أيام`} — جدّد الآن لتفادي إغلاق الحساب.`
            : "اشتراكك ينتهي اليوم — جدّد الآن لتفادي إغلاق الحساب."}
        </div>
      )}

      <main className="p-6">
        {tab === "reception" && (
          <ReceptionTab clinic={clinic} appts={appts} onChanged={() => reloadAppts(clinic)} />
        )}
        {tab === "tv" && <WaitingRoomTv appts={appts} />}
        {tab === "settings" && (
          <SettingsTab clinic={clinic} onSaved={(c) => { setClinic(c); reloadAppts(c); }} />
        )}
        {error && <p className="mt-4 text-red-600">{error}</p>}
      </main>
    </div>
  );
}

function ReceptionTab({
  clinic,
  appts,
  onChanged,
}: {
  clinic: ClinicDoc;
  appts: AppointmentDoc[];
  onChanged: () => void;
}) {
  const slots = generateDaySlots(clinic);
  const byTime = new Map(appts.map((a) => [a.startTime, a]));

  async function handleStatusChange(id: string, status: AppointmentStatus) {
    await setAppointmentStatus(id, status);
    onChanged();
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
                    <select
                      value={a.status}
                      onChange={(e) => handleStatusChange(a.id, e.target.value as AppointmentStatus)}
                      className="rounded border px-2 py-1"
                    >
                      {(Object.keys(STATUS_LABEL) as AppointmentStatus[]).map((st) => (
                        <option key={st} value={st}>
                          {STATUS_LABEL[st]}
                        </option>
                      ))}
                    </select>
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

const SLOT_OPTIONS: (5 | 10 | 15 | 20)[] = [5, 10, 15, 20];

function SettingsTab({ clinic, onSaved }: { clinic: ClinicDoc; onSaved: (c: ClinicDoc) => void }) {
  const [workStart, setWorkStart] = useState(clinic.workStart);
  const [workEnd, setWorkEnd] = useState(clinic.workEnd);
  const [slotMin, setSlotMin] = useState<5 | 10 | 15 | 20>(clinic.slotMin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await updateClinicSchedule(clinic.slug, { workStart, workEnd, slotMin });
      onSaved({ ...clinic, workStart, workEnd, slotMin });
      setSaved(true);
    } catch (err) {
      if (err instanceof ScheduleConflictError) {
        setError(`لا يمكن حفظ هذا التعديل — يوجد مواعيد محجوزة تقع خارج الدوام الجديد: ${err.conflictingTimes.join("، ")}. ألغِ أو أجّل هذه المواعيد أولاً.`);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md space-y-4 rounded-xl border bg-white p-6">
      <div className="grid grid-cols-2 gap-4">
        <label className="block text-sm">
          بداية الدوام
          <input
            type="time"
            value={workStart}
            onChange={(e) => setWorkStart(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          نهاية الدوام
          <input
            type="time"
            value={workEnd}
            onChange={(e) => setWorkEnd(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2"
          />
        </label>
      </div>
      <label className="block text-sm">
        مدة الموعد الواحد
        <select
          value={slotMin}
          onChange={(e) => setSlotMin(Number(e.target.value) as 5 | 10 | 15 | 20)}
          className="mt-1 w-full rounded-lg border px-3 py-2"
        >
          {SLOT_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m} دقائق
            </option>
          ))}
        </select>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-green-700">تم الحفظ.</p>}

      <button
        onClick={handleSave}
        disabled={busy}
        className="w-full rounded-lg bg-brand-500 px-4 py-2 text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {busy ? "جارٍ الحفظ…" : "حفظ"}
      </button>
    </div>
  );
}
