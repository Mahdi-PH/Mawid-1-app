"use client";

import { useRouter } from "next/navigation";

/** A persistent, working back control meant to appear on every screen in
 *  the app (see CLAUDE.md). Prefers real browser history via router.back()
 *  — so it returns to wherever the visitor actually came from — and only
 *  falls back to `fallbackHref` when there's no history to go back to (a
 *  fresh tab, a bookmarked/shared deep link, or the installed PWA's own
 *  launch screen landing directly on this route).
 *
 *  Pass `alwaysUseFallback` to skip the history check and always navigate
 *  straight to `fallbackHref` — used on /clinic, where "back" must go only
 *  to the home screen ("نافذة الرجوع فقط للشاشة الرئيسية") rather than
 *  literally back through the login/signup screens the owner passed
 *  through to get signed in, which `router.back()` would otherwise do. */
export default function BackButton({
  fallbackHref = "/",
  label = "رجوع",
  className = "text-sm text-brand-600 hover:underline",
  alwaysUseFallback = false,
}: {
  fallbackHref?: string;
  label?: string;
  className?: string;
  alwaysUseFallback?: boolean;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (!alwaysUseFallback && typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      className={className}
    >
      ‹ {label}
    </button>
  );
}
