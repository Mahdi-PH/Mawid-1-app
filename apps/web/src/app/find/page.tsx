"use client";

// Public patient directory - no login, ever (see lib/firebase/auth.ts
// ensurePatientSession(), only called once a visitor actually books).
// Lists only clinics/{slug}.status === "approved" (listApprovedClinics())
// so a still-pending or rejected signup stays invisible here exactly like
// the demo artifact's directoryClinics(), just against real Firestore data
// instead of localStorage. Search matches clinic name + governorate/
// district text, same fields the demo's single search box matches - no
// GPS, per the same product decision already made for the artifact.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { listApprovedClinics } from "../../lib/firebase/firestore";
import type { ClinicDoc } from "../../lib/firebase/types";
import BackButton from "../../components/BackButton";
import AppBackdrop from "../../components/AppBackdrop";
import PatientAccountBar from "../../components/PatientAccountBar";
import {
  beginSession,
  getActiveBooking,
  getPatientProfile,
  loginWithPhoneAndPin,
  type ActiveBooking,
  type PatientProfile,
} from "../../lib/patientLocal";

export default function FindClinicPage() {
  // undefined = hasn't checked localStorage yet (avoids a flash of the
  // gate before we know a saved profile exists, same reasoning as the
  // home screen's own localStorage-gated splash check).
  const [profile, setProfile] = useState<PatientProfile | null | undefined>(undefined);
  const [activeBooking, setActiveBooking] = useState<ActiveBooking | null>(null);

  useEffect(() => {
    setProfile(getPatientProfile());
    setActiveBooking(getActiveBooking());
  }, []);

  if (profile === undefined) {
    return (
      <div className="relative min-h-screen">
        <AppBackdrop />
      </div>
    );
  }

  if (profile === null) {
    return (
      <PatientGate
        onDone={(p) => {
          setProfile(p);
          setActiveBooking(getActiveBooking());
        }}
      />
    );
  }

  return (
    <FindClinicSearch profile={profile} activeBooking={activeBooking} />
  );
}

function PatientGate({ onDone }: { onDone: (profile: PatientProfile) => void }) {
  // "إنشاء حساب" collects name+phone+PIN and starts/resumes a local
  // profile (see beginSession()); "تسجيل دخول" is the return-visitor side
  // — phone+PIN only, no name to retype — matched against whatever's
  // already stored (see loginWithPhoneAndPin()). Same signup/login toggle
  // pattern already used for clinic accounts on /signup.
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    if (mode === "login") {
      if (!phone.trim()) return setError("أدخل رقم هاتفك");
      if (!pin.trim()) return setError("أدخل رمز المرور");
      const found = loginWithPhoneAndPin(phone.trim(), pin.trim());
      if (!found) return setError("رقم الهاتف أو رمز المرور غير صحيح.");
      setError(null);
      onDone(found);
      return;
    }
    if (!name.trim()) return setError("أدخل اسمك");
    if (!phone.trim()) return setError("أدخل رقم هاتفك");
    if (!/^\d{4,}$/.test(pin.trim())) return setError("أدخل رمزاً (PIN) من 4 أرقام على الأقل");
    setError(null);
    onDone(beginSession({ name: name.trim(), phone: phone.trim(), pin: pin.trim() }));
  }

  return (
    <main dir="rtl" className="relative min-h-screen mx-auto max-w-md p-6">
      <AppBackdrop />
      <div className="relative">
        <BackButton fallbackHref="/" className="mb-3 block text-sm text-brand-600 hover:underline" />
        <h1 className="mb-6 text-xl font-bold" style={{ color: "#0F7A6C" }}>
          {mode === "signup" ? "إنشاء حساب" : "تسجيل الدخول"}
        </h1>

        <div className="space-y-3 rounded-xl border bg-white p-4">
          {mode === "signup" && (
            <label className="block text-sm">
              الاسم
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2"
              />
            </label>
          )}
          <label className="block text-sm">
            رقم الهاتف
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            {mode === "signup" ? "رمز (PIN) من 4 أرقام على الأقل" : "رمز المرور"}
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              inputMode="numeric"
              dir="ltr"
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            onClick={handleSubmit}
            className="w-full rounded-lg bg-brand-500 px-4 py-2 font-bold text-white hover:bg-brand-600"
          >
            {mode === "signup" ? "متابعة" : "تسجيل الدخول"}
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signup" ? "login" : "signup");
            setError(null);
          }}
          className="mt-4 block w-full text-center text-sm text-brand-600 hover:underline"
        >
          {mode === "signup" ? "لديك حساب بالفعل؟ سجّل الدخول" : "ليس لديك حساب؟ أنشئ حساباً جديداً"}
        </button>
      </div>
    </main>
  );
}

function FindClinicSearch({
  profile,
  activeBooking,
}: {
  profile: PatientProfile;
  activeBooking: ActiveBooking | null;
}) {
  const [clinics, setClinics] = useState<ClinicDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    listApprovedClinics()
      .then(setClinics)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim();
    if (!needle) return clinics;
    return clinics.filter((c) => {
      const haystack = `${c.clinicName} - ${c.district ?? ""} ${c.gov ?? ""}`;
      return haystack.includes(needle);
    });
  }, [clinics, q]);

  return (
    <main dir="rtl" className="relative min-h-screen mx-auto max-w-2xl p-6">
      <AppBackdrop />
      <div className="relative">
      <BackButton fallbackHref="/" className="mb-3 block text-sm text-brand-600 hover:underline" />

      <PatientAccountBar profile={profile} />

      {activeBooking && (
        <Link
          href={`/find/wait?clinic=${encodeURIComponent(activeBooking.clinicSlug)}&appt=${encodeURIComponent(activeBooking.apptId)}`}
          className="mb-6 block rounded-xl border-2 p-4 transition hover:-translate-y-0.5"
          style={{ borderColor: "#0F7A6C", background: "#EEF7F6" }}
        >
          <div className="text-sm text-gray-500">موعدك الحالي</div>
          <div className="font-bold" style={{ color: "#0F7A6C" }}>
            {activeBooking.clinicName} — {activeBooking.startTime}
          </div>
          <div className="mt-1 text-xs text-brand-600">فتح شاشة الانتظار ‹</div>
        </Link>
      )}

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: "#0F7A6C" }}>
          ابحث عن مركزك
        </h1>
        <Link href="/find/requests" className="text-sm text-brand-600 hover:underline">
          طلباتي
        </Link>
      </div>

      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ابحث باسم العيادة أو الحي"
        className="mb-6 w-full rounded-lg border px-3 py-2"
      />

      {loading && <p className="text-gray-500">جارٍ التحميل…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <p className="text-gray-400">لا توجد عيادة مطابقة.</p>
      )}

      <div className="space-y-3">
        {filtered.map((c) => (
          <Link
            key={c.slug}
            href={`/find/book?clinic=${encodeURIComponent(c.slug)}`}
            className="block rounded-xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5"
          >
            <div className="font-bold">{c.clinicName}</div>
            <div className="text-sm text-gray-500">
              {c.specialty} · {c.doctorName}
              {c.gov && ` · ${c.gov}${c.district ? " - " + c.district : ""}`}
            </div>
          </Link>
        ))}
      </div>
      </div>
    </main>
  );
}
