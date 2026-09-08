"use client";

// The patient-side equivalent of ClinicAccountDrawer/AdminSettingsDrawer —
// a settings icon pinned at the screen's physical top-left corner (same
// spot, same gear icon, same slide-over shell as those two) replacing the
// old inline PatientAccountBar ("مرحباً {name}" + a bare sign-out button).
// Menu is intentionally short: two navigation links (حجوزاتي — renamed
// from "طلباتي", now the one central place for every booking a patient
// has ever made, not just pending requests — والسجل الطبي, renamed from
// "بطاقتي الصحية" per the user's explicit ask) plus sign-out
// pinned at the bottom, exactly the three options a patient needs and
// nothing else — there's no nested tool state here (unlike the clinic/
// admin drawers) since both menu items are just page navigations, not
// in-drawer panels.
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import AppBackdrop from "./AppBackdrop";
import ConfirmPopup from "./ConfirmPopup";
import { signOutPatient, type PatientProfile } from "../lib/patientLocal";

/** `open`/`onClose` are optional controlled overrides — every existing call
 *  site (`<PatientSettingsDrawer profile={profile} />`) keeps working
 *  unchanged, self-managing its own open state and rendering its own gear-
 *  icon trigger button. `/find`'s new two-card header (see FindTopBar in
 *  app/find/page.tsx) passes both explicitly instead, so it can drive this
 *  drawer from its own custom-styled "الإعدادات" card rather than the
 *  small circular button — the same optional-controlled-prop shape
 *  BackButton's own `alwaysUseFallback` already established in this file
 *  set, not a new pattern. */
export default function PatientSettingsDrawer({
  profile,
  open: controlledOpen,
  onClose: controlledOnClose,
}: {
  profile: PatientProfile;
  open?: boolean;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  function close() {
    if (isControlled) controlledOnClose?.();
    else setInternalOpen(false);
  }

  function handleConfirmSignOut() {
    setConfirmingSignOut(false);
    signOutPatient();
    router.push("/");
  }

  return (
    <>
      {!isControlled && (
        <button
          type="button"
          onClick={() => setInternalOpen(true)}
          aria-label="إعدادات الحساب"
          className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
        >
          <GearIcon />
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => close()} />
          <div
            dir="rtl"
            className="absolute left-0 top-0 flex h-full w-full max-w-sm flex-col shadow-2xl"
          >
            <AppBackdrop />
            <div className="relative flex items-center justify-between border-b border-black/5 px-5 py-4">
              <h2 className="text-lg font-extrabold" style={{ color: "#00ADB5" }}>
                إعدادات الحساب
              </h2>
              <button
                type="button"
                onClick={() => close()}
                aria-label="إغلاق"
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-black/5"
              >
                ✕
              </button>
            </div>

            <div className="relative flex-1 overflow-y-auto p-5">
              <div className="flex h-full flex-col">
                <p className="mb-4 text-sm text-gray-500">
                  مرحباً، <span className="font-bold text-gray-800">{profile.name}</span>
                </p>

                <div className="space-y-2">
                  <Link
                    href="/find/requests"
                    onClick={() => close()}
                    className="flex w-full items-center gap-3 rounded-xl bg-white px-3 py-3 text-right shadow-sm ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <span
                      aria-hidden
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-base"
                      style={{ backgroundColor: "#EAF6F3", color: "#00ADB5" }}
                    >
                      📋
                    </span>
                    <span className="font-bold text-gray-800">حجوزاتي</span>
                    <span className="mr-auto text-gray-300">‹</span>
                  </Link>

                  <Link
                    href="/find/passport"
                    onClick={() => close()}
                    className="flex w-full items-center gap-3 rounded-xl bg-white px-3 py-3 text-right shadow-sm ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <span
                      aria-hidden
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-base"
                      style={{ backgroundColor: "#EAF6F3", color: "#00ADB5" }}
                    >
                      🩺
                    </span>
                    <span className="font-bold text-gray-800">السجل الطبي</span>
                    <span className="mr-auto text-gray-300">‹</span>
                  </Link>
                </div>

                <div className="mt-auto border-t border-black/5 pt-4">
                  <button
                    type="button"
                    onClick={() => setConfirmingSignOut(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 px-3 py-3 font-bold text-red-600 ring-1 ring-red-100 hover:bg-red-100"
                  >
                    🚪 تسجيل الخروج
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmPopup
        open={confirmingSignOut}
        title="هل تريد تسجيل الخروج؟"
        message="يمكنك الرجوع لاحقاً بنفس بياناتك."
        confirmLabel="تأكيد الخروج"
        onConfirm={handleConfirmSignOut}
        onCancel={() => setConfirmingSignOut(false)}
      />
    </>
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
