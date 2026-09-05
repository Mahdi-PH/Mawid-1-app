"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmPopup from "./ConfirmPopup";
import { signOutPatient, type PatientProfile } from "../lib/patientLocal";

/** Shown on every patient-facing screen once a local profile exists —
 *  "مرحباً {name}" plus a sign-out control. Sign-out asks for one-click
 *  confirmation, then ends the local session and returns to the home
 *  screen — same "confirm + land on /" convention the clinic/admin
 *  sign-out buttons use elsewhere in this app. It does NOT delete the
 *  saved profile/booking data (see signOutPatient()) — entering the same
 *  name/phone/PIN again on /find brings the same local account back. */
export default function PatientAccountBar({ profile }: { profile: PatientProfile }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  function handleConfirmSignOut() {
    signOutPatient();
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

      <ConfirmPopup
        open={confirming}
        title="هل تريد تسجيل الخروج؟"
        message="يمكنك الرجوع لاحقاً بنفس بياناتك."
        confirmLabel="تأكيد الخروج"
        onConfirm={handleConfirmSignOut}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
