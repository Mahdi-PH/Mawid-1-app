"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clearPatientSession, type PatientProfile } from "../lib/patientLocal";

/** Shown on every patient-facing screen once a local profile exists —
 *  "مرحباً {name}" plus a sign-out control. Sign-out asks for one-click
 *  confirmation in a small popup (not a native confirm(), for consistent
 *  styling with the rest of the app), then clears the local session and
 *  returns to the home screen — same "clear + land on /" convention the
 *  clinic/admin sign-out buttons already use elsewhere in this app. */
export default function PatientAccountBar({ profile }: { profile: PatientProfile }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  function handleConfirmSignOut() {
    clearPatientSession();
    router.push("/");
  }

  return (
    <div className="mb-4 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
      <span className="text-gray-600">
        مرحباً، <span className="font-bold text-gray-800">{profile.name}</span>
      </span>
      <button type="button" onClick={() => setConfirming(true)} className="font-medium text-red-600 hover:underline">
        تسجيل خروج
      </button>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          onClick={() => setConfirming(false)}
        >
          <div
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-xl"
          >
            <p className="mb-4 font-bold text-gray-800">هل تريد تسجيل الخروج؟</p>
            <p className="mb-5 text-xs text-gray-500">سيتم مسح بيانات حسابك المحفوظة على هذا الجهاز.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-lg border px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmSignOut}
                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white hover:bg-red-700"
              >
                تأكيد الخروج
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
