"use client";

// Query-param route (?clinic=slug), same reason as /admin/user: a static
// export can't enumerate every clinic slug as a dynamic segment at build
// time. Shows today's slot grid only (matching the demo artifact's
// "today's live slot grid" - no multi-day picker) and lets an anonymous
// patient request a slot with just name + phone, via the same
// ensurePatientSession()/bookSlot() the Firebase backend has had since
// the accounts track was first built - this page is the missing UI in
// front of it.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import BackButton from "../../../components/BackButton";
import AppBackdrop from "../../../components/AppBackdrop";
import { ensurePatientSession } from "../../../lib/firebase/auth";
import {
  bookSlot,
  getAppointmentId,
  getClinic,
  getSlotAvailability,
  isSubscriptionActive,
  SlotTakenError,
} from "../../../lib/firebase/firestore";
import { generateDaySlots } from "../../../lib/firebase/slotEngine";
import type { ClinicDoc } from "../../../lib/firebase/types";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function BookClinicPage() {
  return (
    <Suspense
      fallback={
        <div className="relative min-h-screen">
          <AppBackdrop />
          <p className="relative p-6 text-gray-500">جارٍ التحميل…</p>
        </div>
      }
    >
      <BookClinic />
    </Suspense>
  );
}

function BookClinic() {
  const slug = useSearchParams().get("clinic") ?? "";
  const date = todayISO();

  const [clinic, setClinic] = useState<ClinicDoc | null | undefined>(undefined); // undefined = loading
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null); // startTime of the confirmed request
  const [confirmedApptId, setConfirmedApptId] = useState<string | null>(null);

  const slots = clinic ? generateDaySlots(clinic) : [];

  const reloadAvailability = useCallback(
    async (c: ClinicDoc) => {
      setAvailabilityLoading(true);
      const map = await getSlotAvailability(
        c.slug,
        date,
        generateDaySlots(c).map((s) => s.startTime)
      );
      setAvailability(map);
      setAvailabilityLoading(false);
    },
    [date]
  );

  useEffect(() => {
    if (!slug) {
      setClinic(null);
      return;
    }
    getClinic(slug).then((c) => {
      const live = c && c.status === "approved" && isSubscriptionActive(c);
      setClinic(live ? c : null);
      if (live && c) reloadAvailability(c);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function handleConfirm() {
    if (!clinic || !selected) return;
    if (!name.trim()) return setError("أدخل اسمك");
    if (!phone.trim()) return setError("أدخل رقم هاتفك");
    setError(null);
    setBusy(true);
    try {
      const uid = (await ensurePatientSession()).uid;
      await bookSlot({
        clinicSlug: clinic.slug,
        date,
        startTime: selected,
        patientUid: uid,
        patientName: name.trim(),
        patientPhone: phone.trim(),
      });
      const apptId = getAppointmentId(clinic.slug, date, selected);
      const waitUrl = `/find/wait?clinic=${encodeURIComponent(clinic.slug)}&appt=${encodeURIComponent(apptId)}`;
      setConfirmed(selected);
      setConfirmedApptId(apptId);
      setSelected(null);
      // Best-effort: open the waiting screen as a second window right
      // away. Some browsers (Safari especially) drop the "triggered by a
      // real click" grace period after an await, so this can get popup-
      // blocked — the button rendered in the confirmation card below is
      // the reliable fallback either way, not just a backup for this.
      window.open(waitUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      if (err instanceof SlotTakenError) {
        setError("هذا الموعد حُجز للتو من شخص آخر — اختر وقتاً آخر.");
        setAvailability((prev) => ({ ...prev, [selected]: false }));
        setSelected(null);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!slug || clinic === null) {
    return (
      <main dir="rtl" className="relative min-h-screen mx-auto max-w-md p-6 text-center">
        <AppBackdrop />
        <div className="relative">
          <p className="text-red-600">هذه العيادة غير موجودة أو غير متاحة للحجز حالياً.</p>
          <BackButton fallbackHref="/find" label="رجوع للبحث" className="mt-4 inline-block text-brand-600 hover:underline" />
        </div>
      </main>
    );
  }

  if (clinic === undefined) {
    return (
      <div className="relative min-h-screen">
        <AppBackdrop />
        <p className="relative p-6 text-gray-500">جارٍ التحميل…</p>
      </div>
    );
  }

  return (
    <main dir="rtl" className="relative min-h-screen mx-auto max-w-2xl p-6">
      <AppBackdrop />
      <div className="relative">
      <BackButton fallbackHref="/find" label="رجوع للبحث" />

      <h1 className="mt-3 text-xl font-bold" style={{ color: "#0F7A6C" }}>
        {clinic.clinicName}
      </h1>
      <p className="mb-6 text-sm text-gray-500">
        {clinic.specialty} · {clinic.doctorName}
        {clinic.gov && ` · ${clinic.gov}${clinic.district ? " - " + clinic.district : ""}`}
      </p>

      {confirmed && (
        <div className="mb-6 space-y-3 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
          <p>تم إرسال طلبك للموعد الساعة {confirmed} — بانتظار تأكيد العيادة.</p>
          {confirmedApptId && (
            <a
              href={`/find/wait?clinic=${encodeURIComponent(clinic.slug)}&appt=${encodeURIComponent(confirmedApptId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700"
            >
              فتح شاشة الانتظار
            </a>
          )}
        </div>
      )}

      <h2 className="mb-3 font-bold">مواعيد اليوم المتاحة</h2>
      {availabilityLoading && <p className="text-gray-500">جارٍ تحميل الأوقات…</p>}
      {!availabilityLoading && slots.length === 0 && (
        <p className="text-gray-400">لا توجد مواعيد متاحة اليوم.</p>
      )}

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {slots.map((s) => {
          const free = availability[s.startTime] ?? false;
          const isSelected = selected === s.startTime;
          return (
            <button
              key={s.startTime}
              disabled={!free || availabilityLoading}
              onClick={() => {
                setSelected(s.startTime);
                setConfirmed(null);
                setError(null);
              }}
              className={
                "rounded-lg border px-2 py-2 text-sm " +
                (isSelected
                  ? "border-brand-600 bg-brand-500 text-white"
                  : free
                    ? "border-brand-200 bg-white text-brand-700 hover:bg-brand-50"
                    : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 line-through")
              }
            >
              {s.startTime}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="mt-6 space-y-3 rounded-xl border bg-white p-4">
          <div className="font-bold">تأكيد الحجز — {selected}</div>
          <label className="block text-sm">
            الاسم
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            رقم الهاتف
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            onClick={handleConfirm}
            disabled={busy}
            className="w-full rounded-lg bg-brand-500 px-4 py-2 text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? "جارٍ الإرسال…" : "تأكيد طلب الموعد"}
          </button>
        </div>
      )}
      </div>
    </main>
  );
}
