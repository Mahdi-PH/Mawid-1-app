"use client";

// ScheduleForm ("إعدادات أوقات الدوام") and SubscriptionTab ("خطة
// الاشتراك") — pulled out of app/clinic/page.tsx into their own shared
// file, rather than exported as named exports from that page module: a
// Next.js App Router page.tsx may only export a default page component
// (plus a small fixed set of special exports like metadata) — any other
// named export fails the build ("X is not a valid Page export field").
// Both components are used by app/clinic/page.tsx's own settings drawer
// entry point and by ClinicAccountDrawer.tsx's "إعدادات أوقات الدوام" /
// "خطة الاشتراك" tools.
import { useState } from "react";
import {
  ScheduleConflictError,
  SUBSCRIPTION_PAYMENT_ACCOUNT,
  SUBSCRIPTION_WARNING_DAYS,
  subscriptionDaysLeft,
  updateClinicSchedule,
} from "../lib/firebase/firestore";
import type { ClinicDoc } from "../lib/firebase/types";

const SLOT_OPTIONS: (5 | 10 | 15 | 20)[] = [5, 10, 15, 20];

/** The schedule-editing form only — no sign-out here (that lives at the
 *  bottom of ClinicAccountDrawer's own menu, regardless of which tool is
 *  open). */
export function ScheduleForm({ clinic, onSaved }: { clinic: ClinicDoc; onSaved: (c: ClinicDoc) => void }) {
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
    <div className="space-y-4">
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

function formatSubscriptionDate(ts: ClinicDoc["subscriptionEndsAt"]): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("ar", { year: "numeric", month: "long", day: "numeric" });
}

/** "خطة الاشتراك" tool inside the settings drawer: the clinic's own
 *  start-to-end subscription window plus the payment account number.
 *  Read-only — renewal itself stays a manual admin action (/admin's
 *  "تجديد شهر" button) since there's no real payment gateway; this is
 *  where the clinic checks its own dates and where to send the transfer,
 *  not a self-service renew control. */
export function SubscriptionTab({ clinic }: { clinic: ClinicDoc }) {
  const [copied, setCopied] = useState(false);
  const daysLeft = subscriptionDaysLeft(clinic);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 bg-white p-6" style={{ borderColor: "#0F7A6C" }}>
        <div className="mb-2 text-sm font-bold" style={{ color: "#0F7A6C" }}>
          الخطة المجانية
        </div>
        <p className="text-sm leading-7 text-gray-600">
          إدارة كاملة للحجوزات، الاستقبال، وشاشة صالة الانتظار. السعر بعد انتهاء الخطة المجانية{" "}
          <span className="font-bold">لم يُحدَّد بعد</span> وسيُعلن لاحقاً.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-gray-50 p-3">
            <div className="text-xs text-gray-400">بداية الاشتراك</div>
            <div className="font-bold">{formatSubscriptionDate(clinic.subscriptionStartedAt)}</div>
          </div>
          <div className="rounded-lg bg-gray-50 p-3">
            <div className="text-xs text-gray-400">نهاية الاشتراك</div>
            <div className="font-bold">{formatSubscriptionDate(clinic.subscriptionEndsAt)}</div>
          </div>
        </div>
        {daysLeft !== null && (
          <p className={"mt-3 text-sm font-bold " + (daysLeft <= SUBSCRIPTION_WARNING_DAYS ? "text-amber-700" : "text-gray-500")}>
            {daysLeft > 0 ? `متبقٍ ${daysLeft === 1 ? "يوم واحد" : `${daysLeft} أيام`} على الاشتراك.` : "اشتراكك ينتهي اليوم."}
          </p>
        )}
      </div>

      <div className="rounded-2xl border bg-white p-6">
        <div className="mb-2 font-bold">الدفع بعد انتهاء الخطة المجانية</div>
        <p className="mb-3 text-sm text-gray-500">
          عند اقتراب موعد الانتهاء، حوّل قيمة الاشتراك (سيُعلن عنها لاحقاً) إلى الحساب التالي، ثم تواصل مع الإدارة
          لتفعيل التجديد:
        </p>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={SUBSCRIPTION_PAYMENT_ACCOUNT}
            dir="ltr"
            className="w-full rounded-lg border bg-gray-50 px-3 py-2 font-mono text-sm"
          />
          <button
            onClick={() => {
              navigator.clipboard?.writeText(SUBSCRIPTION_PAYMENT_ACCOUNT);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="shrink-0 rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
          >
            {copied ? "تم النسخ" : "نسخ"}
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-400">طريقة الدفع هنا تجريبية وقابلة للتغيير لاحقاً.</p>
      </div>
    </div>
  );
}
