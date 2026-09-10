"use client";

import { useRouter } from "next/navigation";

// The one back-arrow icon this button ever draws — a real SVG chevron,
// not a Unicode "‹"/"›" glyph (which some renderers can flip inconsistently
// under dir="rtl" and which reads as a text character to a screen reader,
// not a control). Points the same visual direction this project's own
// established in-page "‹ رجوع" links already use (left) — reused for
// consistency with the app's existing convention, not re-decided here.
function BackArrowIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

/** A persistent, working back control meant to appear on every screen in
 *  the app (see CLAUDE.md) — a circular, brand-teal icon button (reusing
 *  the exact same solid #00ADB5-circle / white-stroke-icon language
 *  already established by the home screen's own arrow button, rather than
 *  inventing a new visual identity), with a real accessibility label and
 *  a comfortable ~40px touch target.
 *
 *  Prefers real browser history via router.back() — so it returns to
 *  wherever the visitor actually came from — and only falls back to
 *  `fallbackHref` when there's no history to go back to (a fresh tab, a
 *  bookmarked/shared deep link, or the installed PWA's own launch screen
 *  landing directly on this route). This is the one, single place "back"
 *  is decided app-wide — every screen renders this same component rather
 *  than its own ad-hoc back logic, so there is exactly one rule to reason
 *  about, not one per screen that can quietly drift out of sync.
 *
 *  Pass `alwaysUseFallback` to skip the history check and always navigate
 *  straight to `fallbackHref` — used on /clinic and /admin, where "back"
 *  must go only to a fixed real screen ("نافذة الرجوع فقط للشاشة
 *  الرئيسية") rather than literally back through the login/signup screens
 *  the owner passed through to get signed in, which `router.back()` would
 *  otherwise do. This is a deliberate, narrow flow-boundary exception —
 *  not a "fixed destination" shortcut used as a blanket default — the
 *  same distinction this project's whole navigation model rests on: back
 *  means the real previous screen everywhere except at a small, named set
 *  of flow boundaries like this one.
 *
 *  Pass `overrideOnClick` when this same physical corner control needs to
 *  behave differently depending on a same-route sub-view (see
 *  lib/useLocalBackStep.ts) — e.g. /find/book's corner button should
 *  return to its own "menu" view first while its "book" sub-view is open,
 *  not jump straight to /find. When provided, it fully replaces the
 *  history-vs-fallback logic below; `fallbackHref`/`alwaysUseFallback` are
 *  simply ignored for that click. */
export default function BackButton({
  fallbackHref = "/",
  label = "رجوع",
  className = "",
  alwaysUseFallback = false,
  overrideOnClick,
}: {
  fallbackHref?: string;
  label?: string;
  className?: string;
  alwaysUseFallback?: boolean;
  overrideOnClick?: () => void;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        if (overrideOnClick) {
          overrideOnClick();
          return;
        }
        if (!alwaysUseFallback && typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      className={
        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-sm transition-transform active:scale-90 " +
        className
      }
      style={{ background: "#00ADB5" }}
    >
      <BackArrowIcon />
    </button>
  );
}
