"use client";

import { useState } from "react";
import BackButton from "./BackButton";
import AppBackdrop from "./AppBackdrop";
import { beginSession, loginWithPhoneAndPin, type PatientProfile } from "../lib/patientLocal";

/** The patient identity gate — shared by /find (search entry) and
 *  /find/book (a clinic's own shared public booking link, which used to
 *  skip straight to the slot grid with no account at all). "إنشاء حساب"
 *  collects name+phone+PIN and starts/resumes a local profile (see
 *  beginSession()); "تسجيل دخول" is the return-visitor side — phone+PIN
 *  only, no name to retype — matched against whatever's already stored
 *  (see loginWithPhoneAndPin()). Same signup/login toggle pattern already
 *  used for clinic accounts on /signup. */
export default function PatientGate({
  onDone,
  backHref = "/",
}: {
  onDone: (profile: PatientProfile) => void;
  backHref?: string;
}) {
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
        <BackButton fallbackHref={backHref} alwaysUseFallback className="mb-3 block text-sm text-brand-600 hover:underline" />
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
