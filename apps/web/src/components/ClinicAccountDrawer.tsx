"use client";

// "إعدادات الحساب" — every clinic-side tool that isn't part of daily
// reception work (مسح سجل المراجع، إعدادات الدوام، خطة الاشتراك) lives here
// now, opened from the gear icon pinned at the dashboard's own top-left
// corner, with sign-out pinned at the bottom of this same menu. Reuses
// ScheduleForm/SubscriptionTab from components/ClinicSettingsTools.tsx —
// a Next.js page.tsx may only export its default page component, so
// those two forms live in their own shared file rather than as named
// exports off app/clinic/page.tsx.
//
// Deliberately conditional-mount, not conditional-CSS-visibility: when
// `open` is false this renders null entirely (same convention as
// ConfirmPopup), which matters most for the "مسح سجل المراجع" tool —
// ScanPatientTab's camera (getUserMedia) only actually stops via its own
// unmount cleanup, so a hidden-but-still-mounted panel would leave the
// camera running in the background.
import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmPopup from "./ConfirmPopup";
import ScanPatientTab from "./ScanPatientTab";
import { ScheduleForm, SubscriptionTab } from "./ClinicSettingsTools";
import { markIntentionalSignOut, signOutUser } from "../lib/firebase/auth";
import type { ClinicDoc } from "../lib/firebase/types";

type Tool = "scan" | "schedule" | "subscription";

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: "scan", label: "مسح سجل المراجع", icon: "📷" },
  { id: "schedule", label: "إعدادات أوقات الدوام", icon: "🕒" },
  { id: "subscription", label: "خطة الاشتراك", icon: "💳" },
];

export default function ClinicAccountDrawer({
  open,
  onClose,
  clinic,
  onScheduleSaved,
}: {
  open: boolean;
  onClose: () => void;
  clinic: ClinicDoc;
  onScheduleSaved: (c: ClinicDoc) => void;
}) {
  const router = useRouter();
  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  if (!open) return null;

  function handleClose() {
    setActiveTool(null);
    onClose();
  }

  async function handleSignOut() {
    setSigningOut(true);
    markIntentionalSignOut();
    await signOutUser();
    router.push("/");
  }

  const toolLabel = TOOLS.find((t) => t.id === activeTool)?.label;

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      <div dir="rtl" className="absolute left-0 top-0 flex h-full w-full max-w-sm flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-bold" style={{ color: "#0F7A6C" }}>
            {activeTool ? toolLabel : "إعدادات الحساب"}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="إغلاق"
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {activeTool === null ? (
            <div className="flex h-full flex-col">
              <div className="space-y-1">
                {TOOLS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTool(t.id)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-right hover:bg-gray-50"
                  >
                    <span className="text-lg" aria-hidden>
                      {t.icon}
                    </span>
                    <span className="font-medium text-gray-700">{t.label}</span>
                    <span className="mr-auto text-gray-300">‹</span>
                  </button>
                ))}
              </div>

              <div className="mt-auto border-t pt-4">
                <button
                  type="button"
                  onClick={() => setConfirmSignOut(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-50 px-3 py-3 font-bold text-red-600 hover:bg-red-100"
                >
                  🚪 تسجيل الخروج
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => setActiveTool(null)}
                className="mb-4 text-sm text-brand-600 hover:underline"
                style={{ color: "#0F7A6C" }}
              >
                ‹ رجوع
              </button>
              {activeTool === "scan" && <ScanPatientTab clinic={clinic} />}
              {activeTool === "schedule" && <ScheduleForm clinic={clinic} onSaved={onScheduleSaved} />}
              {activeTool === "subscription" && <SubscriptionTab clinic={clinic} />}
            </div>
          )}
        </div>
      </div>

      <ConfirmPopup
        open={confirmSignOut}
        title="هل تريد تسجيل الخروج؟"
        confirmLabel="تسجيل الخروج"
        cancelLabel="إلغاء"
        busy={signingOut}
        onConfirm={handleSignOut}
        onCancel={() => setConfirmSignOut(false)}
      />
    </div>
  );
}
