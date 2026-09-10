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
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import ConfirmPopup from "../../components/ConfirmPopup";
import NotificationsDrawer from "../../components/NotificationsDrawer";
import EntityTypeGrid from "../../components/EntityTypeGrid";
import { ensurePatientSession } from "../../lib/firebase/auth";
import { deleteAppointment, listApprovedClinics, watchAppointment } from "../../lib/firebase/firestore";
import { unreadNotificationCount, watchNotifications } from "../../lib/firebase/notificationCenter";
import type { AppNotificationDoc, AppointmentDoc, ClinicDoc, EntityType } from "../../lib/firebase/types";
import { SERVICE_CATEGORY_META, resolveEntityType } from "../../lib/serviceCategories";
import BackButton from "../../components/BackButton";
import AppBackdrop from "../../components/AppBackdrop";
import PatientSettingsDrawer from "../../components/PatientSettingsDrawer";
import PatientGate from "../../components/PatientGate";
import { useLocalBackStep } from "../../lib/useLocalBackStep";

const KNOWN_CATEGORIES: EntityType[] = ["beauty", "clinic", "salon"];
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
  const [initialQuery, setInitialQuery] = useState("");
  const [showEndPrompt, setShowEndPrompt] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Restores the exact category/search-query a patient had picked before
  // opening a clinic's own details (/find/book), instead of always
  // resetting to the category-selection screen on "back" — /find/book's
  // own physical back button appends these back onto this same route (see
  // that file). Read once, before first paint (matching the pre-paint
  // ?intro=1/?mode=login technique already used elsewhere in this app),
  // so there's no visible flash of the category screen before the search
  // results replace it.
  const restoredInitialState = useRef(false);
  useLayoutEffect(() => {
    if (restoredInitialState.current) return;
    restoredInitialState.current = true;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const cat = params.get("category");
    if (cat && (KNOWN_CATEGORIES as string[]).includes(cat)) {
      setCategory(cat as EntityType);
      setInitialQuery(params.get("q") ?? "");
    }
  }, []);

  // See lib/useLocalBackStep.ts: picking a category is a plain useState
  // step with no history entry of its own, so a real back press/gesture
  // used to skip straight past the category-selection screen to whatever
  // preceded /find entirely. Entering a category now also pushes a
  // same-URL history marker, so a real back returns to that screen first —
  // the exact same one step the in-page "‹ رجوع لاختيار نوع الخدمة" link
  // (inside FindClinicSearch) already performs.
  const { enter: enterCategoryStep, leave: leaveCategoryStep } = useLocalBackStep(() => setCategory(null));

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
        {category !== null ? (
          // One step at a time: while search results are showing, the
          // physical corner control returns to the category-selection
          // screen first — same destination as the in-page "‹ رجوع
          // لاختيار نوع الخدمة" link, just reachable from the fixed
          // corner control too, and from a real back press/gesture.
          <BackButton label="رجوع" overrideOnClick={leaveCategoryStep} className="mb-3" />
        ) : (
          <BackButton fallbackHref="/" alwaysUseFallback className="mb-3" />
        )}

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
          <ServiceCategoryFilter
            onSelect={(t) => {
              enterCategoryStep();
              setCategory(t);
            }}
            {...topBarActions}
          />
        ) : (
          <FindClinicSearch
            category={category}
            initialQuery={initialQuery}
            onChangeCategory={leaveCategoryStep}
            {...topBarActions}
          />
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
      className="relative flex w-[74px] flex-none flex-col items-center justify-center gap-1 rounded-2xl border bg-white px-2 py-3 text-center shadow-sm transition hover:-translate-y-0.5"
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

function PersonBadgeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
    </svg>
  );
}

/** The shared heading row for both /find phases — a calm, self-contained
 *  intro card on the right, the existing settings/notifications card pair
 *  on the left, matching the reference screenshot's layout. Deliberately
 *  a plain Header/Intro Section, not a navigation control — no arrow or
 *  back button lives inside it; the page's own physical back button (see
 *  FindClinicPage/BackButton) sits outside and above this row entirely.
 *  A plain `flex justify-between` inside this `dir="rtl"` page already
 *  places its first DOM child (the card) at the physical right and its
 *  second (the icon-card row) at the physical left — no manual
 *  positioning needed, same RTL-flex reasoning already documented for the
 *  home screen's own role-card order.
 *
 *  `title` is optional: when omitted (the category-selection screen —
 *  see ServiceCategoryFilter below), the card keeps only its one
 *  `subtitle` line, sized up and colored the app's own primary teal
 *  since it's now the card's sole, primary content rather than a
 *  secondary caption under a heading. Either way the row uses the
 *  flexbox default (`align-items: stretch`, no `items-start` override)
 *  so this card and the two `TopIconCard`s beside it settle on one true
 *  shared height — driven by this card's own `min-h-[74px]`, not a
 *  second, independently-guessed number on the icon cards — instead of
 *  two components each assuming a height that could drift apart later. */
function FindTopBar({
  title,
  subtitle,
  onOpenSettings,
  onOpenNotifications,
  unreadCount,
}: TopBarActions & { title?: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-6 flex justify-between gap-3">
      <div
        className={
          "relative flex min-h-[74px] min-w-0 flex-1 flex-col justify-center rounded-2xl border shadow-sm " +
          (title ? "px-4" : "px-3")
        }
        style={{
          borderColor: "#e5eef0",
          background: "linear-gradient(135deg, #FBF7EF 0%, #F2FBFC 55%, #EAF6F3 100%)",
        }}
      >
        <span
          aria-hidden
          className="absolute -top-3 -right-3 flex h-9 w-9 items-center justify-center rounded-full border-2 bg-white shadow-sm"
          style={{ borderColor: "#00ADB5", color: "#00ADB5" }}
        >
          <PersonBadgeIcon />
        </span>
        {title && (
          <h1 className="pr-8 text-xl font-bold leading-snug" style={{ color: "#00ADB5" }}>
            {title}
          </h1>
        )}
        {subtitle && (
          <p
            className={
              title
                ? "mt-1 pr-8 text-sm leading-relaxed text-gray-500"
                : "pr-6 text-[13px] font-bold leading-snug sm:text-base"
            }
            style={title ? undefined : { color: "#00ADB5" }}
          >
            {subtitle}
          </p>
        )}
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
        subtitle="اختر الخدمة التي تبحث عنها"
        onOpenSettings={onOpenSettings}
        onOpenNotifications={onOpenNotifications}
        unreadCount={unreadCount}
      />

      <EntityTypeGrid onSelect={onSelect} />
    </div>
  );
}

function FindClinicSearch({
  category,
  initialQuery,
  onChangeCategory,
  onOpenSettings,
  onOpenNotifications,
  unreadCount,
}: {
  category: EntityType;
  initialQuery: string;
  onChangeCategory: () => void;
} & TopBarActions) {
  const [clinics, setClinics] = useState<ClinicDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(initialQuery);

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
  // Carried onto /find/book's own link so its back button can restore
  // this exact category/query when the patient returns — see that page's
  // own comment on backCategory/backQuery.
  const backParams = `category=${encodeURIComponent(category)}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`;

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
            href={`/find/book?clinic=${encodeURIComponent(c.slug)}&${backParams}`}
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
