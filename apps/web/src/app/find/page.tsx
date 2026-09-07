"use client";

// Public patient directory - no login, ever (see lib/firebase/auth.ts
// ensurePatientSession(), only called once a visitor actually books).
// Lists only clinics/{slug}.status === "approved" (listApprovedClinics())
// so a still-pending or rejected signup stays invisible here exactly like
// the demo artifact's directoryClinics(), just against real Firestore data
// instead of localStorage. Search matches clinic name + governorate/
// district text, same fields the demo's single search box matches - no
// GPS, per the same product decision already made for the artifact.
//
// A service-category filter step (مراكز تجميل / عيادات طبية / أخرى) now
// sits between the patient gate and the actual search UI — see
// lib/serviceCategories.ts for why this reuses ClinicDoc.entityType
// rather than a new field. The search screen itself (FindClinicSearch)
// isn't duplicated per category: it's the exact same component, now
// filtering on a `category` prop, matching the request's own "don't
// repeat the search screen if it can take a category parameter instead."
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import ConfirmPopup from "../../components/ConfirmPopup";
import NotificationsDrawer from "../../components/NotificationsDrawer";
import ServiceCategoryCard from "../../components/ServiceCategoryCard";
import { ensurePatientSession } from "../../lib/firebase/auth";
import { deleteAppointment, listApprovedClinics, watchAppointment } from "../../lib/firebase/firestore";
import { unreadNotificationCount, watchNotifications } from "../../lib/firebase/notificationCenter";
import type { AppNotificationDoc, AppointmentDoc, ClinicDoc, EntityType } from "../../lib/firebase/types";
import { SERVICE_CATEGORY_META, SERVICE_CATEGORY_ORDER, resolveEntityType } from "../../lib/serviceCategories";
import BackButton from "../../components/BackButton";
import AppBackdrop from "../../components/AppBackdrop";
import PatientSettingsDrawer from "../../components/PatientSettingsDrawer";
import PatientGate from "../../components/PatientGate";
import {
  clearActiveBooking,
  getActiveBooking,
  getPatientProfile,
  isEndPromptDismissed,
  markEndPromptDismissed,
  type ActiveBooking,
  type PatientProfile,
} from "../../lib/patientLocal";

const TERMINAL_STATUSES = new Set(["completed", "cancelled", "no_show"]);

/** Shared props every /find header (category-select or search) needs to
 *  open the settings/notifications drawers and show the live unread
 *  count — passed down from FindClinicPage, which owns the one live
 *  watchNotifications() subscription both the badge and the drawer's own
 *  content read from (see FindTopBar below). */
interface TopBarActions {
  onOpenSettings: () => void;
  onOpenNotifications: () => void;
  unreadCount: number;
}

export default function FindClinicPage() {
  // undefined = hasn't checked localStorage yet (avoids a flash of the
  // gate before we know a saved profile exists, same reasoning as the
  // home screen's own localStorage-gated splash check).
  const [profile, setProfile] = useState<PatientProfile | null | undefined>(undefined);
  const [activeBooking, setActiveBooking] = useState<ActiveBooking | null>(null);
  const [category, setCategory] = useState<EntityType | null>(null);
  const [showEndPrompt, setShowEndPrompt] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Notification Center — one live subscription at this top level (not
  // inside NotificationsDrawer, and not re-subscribed per phase) so the
  // same list drives both the bell's unread badge (visible even while the
  // drawer is closed) and the drawer's own content once opened.
  const [patientUid, setPatientUid] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<AppNotificationDoc[] | null>(null);
  const [notifLoadError, setNotifLoadError] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    setProfile(getPatientProfile());
    setActiveBooking(getActiveBooking());
  }, []);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    ensurePatientSession().then((u) => {
      if (!cancelled) setPatientUid(u.uid);
    });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  useEffect(() => {
    if (!patientUid) return;
    setNotifLoadError(false);
    return watchNotifications(
      patientUid,
      (rows) => setNotifications(rows),
      () => setNotifLoadError(true)
    );
  }, [patientUid]);

  // Covers the same "انتهى موعدك، هل تريد حذف الحجز؟" prompt as
  // /find/wait, but for a patient who lands back on /find directly
  // (closed the waiting-screen tab, or never opened it) instead of
  // reopening the specific appointment's own page — live via onSnapshot,
  // not a one-time fetch, so it still fires if the clinic finishes the
  // visit while this tab happens to be open. Lives at this top level
  // (not inside whichever phase is currently showing) so "موعدك الحالي"
  // stays reachable immediately after auth, without needing to pick a
  // category first — an active booking already belongs to one specific
  // clinic, so gating it behind an unrelated category choice would be a
  // real regression to the resume-your-booking flow this project already
  // built and tested (see CLAUDE.md's patient-local-session sections).
  useEffect(() => {
    if (!activeBooking) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    ensurePatientSession().finally(() => {
      if (cancelled) return;
      unsubscribe = watchAppointment(activeBooking.apptId, (appt) => {
        if (!appt) {
          // Resolves to null both for a genuinely deleted appointment and
          // for a denied read (see watchAppointment()'s own comment) —
          // either way, "موعدك الحالي" can never point anywhere useful
          // again, so clear it here instead of leaving this card stuck
          // linking to a dead /find/wait page forever.
          clearActiveBooking();
          setActiveBooking(null);
          return;
        }
        if (TERMINAL_STATUSES.has(appt.status)) clearActiveBooking();
        if (appt.status === "completed" && !isEndPromptDismissed(appt.id)) setShowEndPrompt(true);
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [activeBooking]);

  async function handleDeleteBooking() {
    if (!activeBooking) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAppointment(activeBooking.apptId);
      clearActiveBooking();
      markEndPromptDismissed(activeBooking.apptId);
      setActiveBooking(null);
      setShowEndPrompt(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  function handleKeepBooking() {
    if (activeBooking) markEndPromptDismissed(activeBooking.apptId);
    setShowEndPrompt(false);
  }

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

  const unreadCount = unreadNotificationCount(notifications ?? []);
  const topBarActions: TopBarActions = {
    onOpenSettings: () => setSettingsOpen(true),
    onOpenNotifications: () => setNotifOpen(true),
    unreadCount,
  };

  return (
    <main dir="rtl" className="relative min-h-screen mx-auto max-w-2xl p-6">
      <AppBackdrop />
      <div className="relative">
        <BackButton fallbackHref="/" alwaysUseFallback className="mb-3 block text-sm text-brand-600 hover:underline" />

        {activeBooking && (
          <Link
            href={`/find/wait?clinic=${encodeURIComponent(activeBooking.clinicSlug)}&appt=${encodeURIComponent(activeBooking.apptId)}`}
            className="mb-6 block rounded-xl border-2 p-4 transition hover:-translate-y-0.5"
            style={{ borderColor: "#00ADB5", background: "#EEF7F6" }}
          >
            <div className="text-sm text-gray-500">موعدك الحالي</div>
            <div className="font-bold" style={{ color: "#00ADB5" }}>
              {activeBooking.clinicName} — {activeBooking.startTime}
            </div>
            <div className="mt-1 text-xs text-brand-600">فتح شاشة الانتظار ‹</div>
          </Link>
        )}
        {deleteError && <p className="mb-4 text-sm text-red-600">{deleteError}</p>}

        {category === null ? (
          <ServiceCategoryFilter onSelect={setCategory} {...topBarActions} />
        ) : (
          <FindClinicSearch category={category} onChangeCategory={() => setCategory(null)} {...topBarActions} />
        )}
      </div>

      <ConfirmPopup
        open={showEndPrompt}
        title="انتهى موعدك، هل تريد حذف الحجز؟"
        confirmLabel="نعم، حذف الحجز"
        cancelLabel="لا، إبقاء السجل"
        busy={deleting}
        onConfirm={handleDeleteBooking}
        onCancel={handleKeepBooking}
      />
      <PatientSettingsDrawer profile={profile} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <NotificationsDrawer
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        notifications={notifications}
        loadError={notifLoadError}
      />
    </main>
  );
}

function ClinicCategoryIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9.5 12 4l8 5.5" />
      <rect x="5" y="9.5" width="14" height="11" rx="1" />
      <path d="M12 12.5v5M9.5 15h5" />
    </svg>
  );
}

function BeautyCategoryIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 4.5c1.6 0 2.8 1.4 2.8 3.1S13.6 10.7 12 10.7 9.2 9.3 9.2 7.6 10.4 4.5 12 4.5Z" />
      <path d="M19.5 12c0 1.6-1.4 2.8-3.1 2.8S13.3 13.6 13.3 12s1.4-2.8 3.1-2.8 3.1 1.2 3.1 2.8Z" />
      <path d="M12 19.5c-1.6 0-2.8-1.4-2.8-3.1s1.2-2.8 2.8-2.8 2.8 1.4 2.8 3.1-1.2 2.8-2.8 2.8Z" />
      <path d="M4.5 12c0-1.6 1.4-2.8 3.1-2.8s2.8 1.4 2.8 3.1-1.4 2.8-3.1 2.8S4.5 13.6 4.5 12Z" />
    </svg>
  );
}

function OtherCategoryIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  );
}

const CATEGORY_ICON: Record<EntityType, ReactNode> = {
  beauty: <BeautyCategoryIcon />,
  clinic: <ClinicCategoryIcon />,
  salon: <OtherCategoryIcon />,
};

function SettingsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function BellTopIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

/** One of the two matching top-corner cards ("الإعدادات"/"الإشعارات") —
 *  same width/height/radius/shadow for both, per the request's own
 *  explicit "نفس العرض، نفس الارتفاع" ask. The whole card is tappable,
 *  not just the icon. `badgeCount` renders the small red unread-count
 *  pill only when > 0 (never an empty badge), capped at "9+"/"99+" per
 *  the request's own explicit ask rather than an ever-growing number. */
function TopIconCard({
  icon,
  label,
  onClick,
  badgeCount,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  badgeCount?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex w-[74px] flex-none flex-col items-center gap-1 rounded-2xl border bg-white px-2 py-3 text-center shadow-sm transition hover:-translate-y-0.5"
      style={{ borderColor: "#e5eef0" }}
    >
      {!!badgeCount && badgeCount > 0 && (
        <span
          aria-hidden
          className="absolute -top-1.5 -right-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
          style={{ background: "#E11D48" }}
        >
          {badgeCount > 99 ? "99+" : badgeCount > 9 ? "9+" : badgeCount}
        </span>
      )}
      <span style={{ color: "#00ADB5" }}>{icon}</span>
      <span className="text-xs font-bold text-gray-700">{label}</span>
    </button>
  );
}

/** The shared heading row for both /find phases — page title/subtitle on
 *  the right (RTL start), the settings/notifications card pair on the
 *  left, matching the reference screenshot's exact layout. A plain `flex
 *  justify-between` inside this `dir="rtl"` page already places its first
 *  DOM child (the heading) at the physical right and its second (the
 *  icon-card row) at the physical left — no manual positioning needed,
 *  same RTL-flex reasoning already documented for the home screen's own
 *  role-card order. */
function FindTopBar({
  title,
  subtitle,
  onOpenSettings,
  onOpenNotifications,
  unreadCount,
}: TopBarActions & { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-3">
      <div className="min-w-0 pt-1">
        <h1 className="text-xl font-bold" style={{ color: "#00ADB5" }}>
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
      </div>
      <div className="flex flex-none gap-2">
        <TopIconCard icon={<BellTopIcon />} label="الإشعارات" onClick={onOpenNotifications} badgeCount={unreadCount} />
        <TopIconCard icon={<SettingsIcon />} label="الإعدادات" onClick={onOpenSettings} />
      </div>
    </div>
  );
}

/** The new step between the patient gate and the search results —
 *  "مراكز تجميل" / "عيادات طبية" (row one) and "أخرى" alone (row two,
 *  centered at the same width as the other two so it doesn't leave a
 *  lopsided empty gap). Picking a category doesn't navigate anywhere —
 *  it's the same `/find` route, just a local state change (matching this
 *  project's own established pattern for a multi-step single-route flow,
 *  see /find/book's "menu"/"book" view state) — so "leaving" it uses
 *  `onChangeCategory` inside FindClinicSearch below, not browser back. */
function ServiceCategoryFilter({
  onSelect,
  onOpenSettings,
  onOpenNotifications,
  unreadCount,
}: { onSelect: (category: EntityType) => void } & TopBarActions) {
  return (
    <div className="animate-fade-in-up">
      <FindTopBar
        title="البحث عن خدمة"
        subtitle="اختر نوع الخدمة التي تبحث عنها"
        onOpenSettings={onOpenSettings}
        onOpenNotifications={onOpenNotifications}
        unreadCount={unreadCount}
      />

      <div className="grid grid-cols-2 gap-3">
        {SERVICE_CATEGORY_ORDER.map((entityType) => {
          const meta = SERVICE_CATEGORY_META[entityType];
          const isLoneRow = entityType === "salon"; // "أخرى" is the only row-two entry
          return (
            <div key={entityType} className={isLoneRow ? "col-span-2 flex justify-center" : ""}>
              <ServiceCategoryCard
                title={meta.title}
                subtitle={meta.subtitle}
                icon={CATEGORY_ICON[entityType]}
                accent={meta.accent}
                iconBg={meta.iconBg}
                onTap={() => onSelect(entityType)}
                className={isLoneRow ? "max-w-[calc(50%-0.375rem)]" : ""}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FindClinicSearch({
  category,
  onChangeCategory,
  onOpenSettings,
  onOpenNotifications,
  unreadCount,
}: {
  category: EntityType;
  onChangeCategory: () => void;
} & TopBarActions) {
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
    const inCategory = clinics.filter((c) => resolveEntityType(c.entityType) === category);
    const needle = q.trim();
    if (!needle) return inCategory;
    return inCategory.filter((c) => {
      const haystack = `${c.clinicName} - ${c.district ?? ""} ${c.gov ?? ""}`;
      return haystack.includes(needle);
    });
  }, [clinics, category, q]);

  const categoryMeta = SERVICE_CATEGORY_META[category];

  return (
    <div className="animate-fade-in-up">
      <button
        type="button"
        onClick={onChangeCategory}
        className="mb-3 block text-sm text-brand-600 hover:underline"
      >
        ‹ رجوع لاختيار نوع الخدمة
      </button>

      <FindTopBar
        title="ابحث عن مركزك"
        subtitle={categoryMeta.title}
        onOpenSettings={onOpenSettings}
        onOpenNotifications={onOpenNotifications}
        unreadCount={unreadCount}
      />

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
        <p className="text-gray-400">لا توجد نتائج مطابقة.</p>
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
  );
}
