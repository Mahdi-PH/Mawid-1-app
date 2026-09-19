"use client";

// The patient-facing Notification Center's own list screen — a slide-over
// panel matching PatientSettingsDrawer's/ClinicAccountDrawer's/
// AdminSettingsDrawer's shared shell (same left-edge slide-over, same
// AppBackdrop, same close button) rather than a new UI pattern. Fully
// controlled from app/find/page.tsx (open/onClose/notifications props) —
// the live Firestore subscription lives at that top level so the same list
// also drives the unread badge on the "الإشعارات" card without a second
// subscription (see watchNotifications() in lib/firebase/
// notificationCenter.ts).
import Link from "next/link";
import type { ReactNode } from "react";
import { markAllNotificationsRead, markNotificationRead } from "../lib/firebase/notificationCenter";
import { STATUS_COLOR } from "../lib/firebase/statusMeta";
import type { AppNotificationDoc, AppointmentStatus } from "../lib/firebase/types";
import AppBackdrop from "./AppBackdrop";

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.3 10.8 15 16 9.5" />
    </svg>
  );
}
function LocationIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 21s-6.5-6.9-6.5-11A6.5 6.5 0 0 1 18.5 10c0 4.1-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.2" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.5l4 2.5" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5 14.5 14.5M14.5 9.5 9.5 14.5" />
    </svg>
  );
}
function BellEmptyIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

const STATUS_ICON: Record<AppointmentStatus, ReactNode> = {
  requested: <BellIcon />,
  booked: <CheckIcon />,
  arrived: <LocationIcon />,
  in_progress: <ClockIcon />,
  completed: <CheckIcon />,
  cancelled: <XIcon />,
  no_show: <XIcon />,
};

/** Plain, careful Arabic relative time — "الآن" / "منذ N دقيقة(دقيقتين/
 *  دقائق)" / ساعة / يوم, matching the singular/dual/plural forms already
 *  used elsewhere in this app (e.g. /find/wait's own queue-count copy). */
function relativeTimeAr(date: Date): string {
  const mins = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (mins < 1) return "الآن";
  if (mins < 60) return `منذ ${mins} ${mins === 1 ? "دقيقة" : mins === 2 ? "دقيقتين" : mins <= 10 ? "دقائق" : "دقيقة"}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `منذ ${hours} ${hours === 1 ? "ساعة" : hours === 2 ? "ساعتين" : hours <= 10 ? "ساعات" : "ساعة"}`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} ${days === 1 ? "يوم" : days === 2 ? "يومين" : days <= 10 ? "أيام" : "يوماً"}`;
}

export default function NotificationsDrawer({
  open,
  onClose,
  notifications,
  loadError,
}: {
  open: boolean;
  onClose: () => void;
  /** null = still waiting on the first snapshot (loading state). */
  notifications: AppNotificationDoc[] | null;
  loadError: boolean;
}) {
  if (!open) return null;

  const hasUnread = (notifications ?? []).some((n) => !n.isRead);

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div dir="rtl" className="absolute left-0 top-0 flex h-full w-full max-w-sm flex-col shadow-2xl">
        <AppBackdrop />
        <div className="relative flex items-center justify-between border-b border-black/5 px-5 py-4">
          <h2 className="text-lg font-extrabold" style={{ color: "#00ADB5" }}>
            الإشعارات
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-black/5"
          >
            ✕
          </button>
        </div>

        {hasUnread && (
          <div className="relative border-b border-black/5 px-5 py-2">
            <button
              type="button"
              onClick={() => markAllNotificationsRead(notifications ?? []).catch(() => {})}
              className="text-sm font-bold text-brand-600 hover:underline"
            >
              تحديد الكل كمقروء
            </button>
          </div>
        )}

        <div className="relative flex-1 overflow-y-auto p-4">
          {notifications === null && !loadError && (
            <p className="p-6 text-center text-sm text-gray-400">جارٍ تحميل الإشعارات…</p>
          )}
          {loadError && <p className="p-6 text-center text-sm text-red-600">تعذّر تحميل الإشعارات.</p>}
          {notifications !== null && !loadError && notifications.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-gray-400">
              <BellEmptyIcon />
              <p className="text-sm">لا توجد إشعارات حالياً</p>
            </div>
          )}
          {notifications && notifications.length > 0 && (
            <div className="space-y-2">
              {notifications.map((n) => (
                <Link
                  key={n.id}
                  href={`/find/wait?clinic=${encodeURIComponent(n.clinicSlug)}&appt=${encodeURIComponent(n.appointmentId)}`}
                  onClick={() => {
                    if (!n.isRead) markNotificationRead(n.id).catch(() => {});
                  }}
                  className={
                    "flex items-start gap-3 rounded-xl px-3 py-3 text-right shadow-sm ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-md " +
                    (n.isRead ? "bg-white/70" : "bg-white")
                  }
                >
                  <span
                    aria-hidden
                    className={"flex h-9 w-9 flex-none items-center justify-center rounded-full border " + STATUS_COLOR[n.status]}
                  >
                    {STATUS_ICON[n.status]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={"block " + (n.isRead ? "font-semibold text-gray-600" : "font-extrabold text-gray-900")}>
                      {n.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-500">{n.body}</span>
                    <span className="mt-1 block text-[11px] text-gray-400">
                      {n.createdAt ? relativeTimeAr(n.createdAt.toDate()) : ""}
                    </span>
                  </span>
                  {!n.isRead && (
                    <span aria-hidden className="mt-1.5 h-2 w-2 flex-none rounded-full" style={{ background: "#E11D48" }} />
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
