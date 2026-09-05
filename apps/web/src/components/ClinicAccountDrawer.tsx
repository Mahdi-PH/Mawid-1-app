"use client";

// "إعدادات الحساب" — every clinic-side tool that isn't part of daily
// reception work (مسح سجل المراجع، إعدادات الدوام، خطة الاشتراك، رابط
// العيادة) lives here now, opened from the gear icon pinned at the
// dashboard's own top-left corner, with sign-out pinned at the bottom of
// this same menu. Reuses ScheduleForm/SubscriptionTab from
// components/ClinicSettingsTools.tsx — a Next.js page.tsx may only export
// its default page component, so those two forms live in their own
// shared file rather than as named exports off app/clinic/page.tsx.
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
import { getTerminology } from "../lib/firebase/terminology";
import type { ClinicDoc } from "../lib/firebase/types";

type Tool = "scan" | "schedule" | "subscription" | "link";

/** Menu labels depend on the clinic's own entityType (e.g. "مسح سجل
 *  المراجع" vs "مسح سجل الزبون") — a plain function of `terms` rather
 *  than a module-level constant, computed fresh each render (cheap: four
 *  short strings). */
function buildTools(terms: ReturnType<typeof getTerminology>): { id: Tool; label: string; icon: string }[] {
  return [
    { id: "scan", label: `مسح سجل ${terms.personNoun}`, icon: "📷" },
    { id: "schedule", label: "إعدادات أوقات الدوام", icon: "🕒" },
    { id: "subscription", label: "خطة الاشتراك", icon: "💳" },
    { id: "link", label: `رابط ${terms.centerNoun}`, icon: "🔗" },
  ];
}

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
  const terms = getTerminology(clinic.entityType);
  const TOOLS = buildTools(terms);

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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={handleClose} />
      <div
        dir="rtl"
        className="absolute left-0 top-0 flex h-full w-full max-w-sm flex-col shadow-2xl"
        style={{ background: "linear-gradient(180deg, #F5FBF9 0%, #FFFFFF 220px)" }}
      >
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
          <h2 className="text-lg font-extrabold" style={{ color: "#0F7A6C" }}>
            {activeTool ? toolLabel : "إعدادات الحساب"}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="إغلاق"
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-black/5"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {activeTool === null ? (
            <div className="flex h-full flex-col">
              <div className="space-y-2">
                {TOOLS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTool(t.id)}
                    className="flex w-full items-center gap-3 rounded-xl bg-white px-3 py-3 text-right shadow-sm ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <span
                      aria-hidden
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-base"
                      style={{ backgroundColor: "#EAF6F3", color: "#0F7A6C" }}
                    >
                      {t.icon}
                    </span>
                    <span className="font-bold text-gray-800">{t.label}</span>
                    <span className="mr-auto text-gray-300">‹</span>
                  </button>
                ))}
              </div>

              <div className="mt-auto border-t border-black/5 pt-4">
                <button
                  type="button"
                  onClick={() => setConfirmSignOut(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 px-3 py-3 font-bold text-red-600 ring-1 ring-red-100 hover:bg-red-100"
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
                className="mb-4 text-sm font-bold hover:underline"
                style={{ color: "#0F7A6C" }}
              >
                ‹ رجوع
              </button>
              {activeTool === "scan" && <ScanPatientTab clinic={clinic} />}
              {activeTool === "schedule" && <ScheduleForm clinic={clinic} onSaved={onScheduleSaved} />}
              {activeTool === "subscription" && <SubscriptionTab clinic={clinic} />}
              {activeTool === "link" && <ClinicLinkTab clinic={clinic} />}
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

/** "رابط العيادة" — the shareable public booking link, moved here from
 *  the dashboard's own header (which used to show it next to the clinic
 *  name) so the header can give the clinic name its own uncluttered,
 *  centered focus instead. Same link/copy behavior as before, just
 *  relocated. */
function ClinicLinkTab({ clinic }: { clinic: ClinicDoc }) {
  const [copied, setCopied] = useState(false);
  const terms = getTerminology(clinic.entityType);
  const bookingLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/find/book?clinic=${encodeURIComponent(clinic.slug)}`
      : "";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
        <div className="mb-2 font-bold text-gray-800">رابط الحجز العام {terms.centerPossessive}</div>
        <p className="mb-3 text-sm text-gray-500">
          شارك هذا الرابط مع {terms.visitorPossessivePlural} — يفتح مباشرة صفحة حجز موعد {terms.centerPossessive}.
        </p>
        <input
          readOnly
          value={bookingLink}
          dir="ltr"
          className="mb-3 w-full rounded-lg border bg-gray-50 px-3 py-2 text-xs text-gray-600"
        />
        <button
          onClick={() => {
            navigator.clipboard?.writeText(bookingLink);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="w-full rounded-lg py-2 font-bold text-white hover:opacity-90"
          style={{ backgroundColor: "#0F7A6C" }}
        >
          {copied ? "تم النسخ ✓" : "نسخ الرابط"}
        </button>
      </div>
    </div>
  );
}
