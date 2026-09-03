"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SplashScreen, { SPLASH_ANIMATION_TOTAL_MS } from "../components/SplashScreen";

// Matches the branded two-sided home screen already iterated in the demo
// artifact (see CLAUDE.md "Two-sided product direction") - logo mark,
// wordmark, teal gradient, role cards - instead of the placeholder MVP
// homepage this used to be (a bare "لوحة الاستقبال"/"شاشة صالة الانتظار"
// pair pointing at apps/server routes that aren't hosted anywhere). مراجع
// now routes to /find (real, Firestore-backed patient directory + booking,
// no account) - see CLAUDE.md "Real patient-facing directory + booking
// (apps/web/src/app/find/)" for what it does and doesn't cover. عيادة أو
// مركز تجميل routes through /subscribe first (the demo artifact's own
// flow: role picker -> subscription info screen -> signup/login), not
// straight to /signup.
//
// Two animations were added here (see CLAUDE.md "Animations"): a one-time
// welcome splash (SplashScreen) on this browser's first-ever visit, and a
// short fade/slide-out on the role cards themselves before navigating away,
// so the screen change doesn't feel like an instant hard cut. Both are pure
// CSS/Tailwind (tailwind.config.js keyframes) — no animation library was
// added, per the user's explicit choice — and neither touches Firebase or
// any data fetch, so they can't slow down anything this page actually
// depends on.
const SPLASH_SEEN_KEY = "mawid_splash_seen";
const EXIT_ANIMATION_MS = 220;

export default function Home() {
  const router = useRouter();
  // null = "haven't checked localStorage yet" (renders nothing but the
  // brand-colored background, so there's no flash of the role-picker
  // content before we know whether the splash should play first).
  const [showSplash, setShowSplash] = useState<boolean | null>(null);
  const [leavingTo, setLeavingTo] = useState<string | null>(null);

  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem(SPLASH_SEEN_KEY) === "1";
    } catch {
      // Storage blocked (private mode, etc.) — fail open to "already seen"
      // rather than showing the splash on every single visit.
    }
    setShowSplash(!seen);
  }, []);

  useEffect(() => {
    if (!showSplash) return;
    // Safety net in case the browser never fires animationend (e.g. the
    // tab was backgrounded mid-animation) — never leaves a real visitor
    // stuck behind the splash indefinitely.
    const t = window.setTimeout(finishSplash, SPLASH_ANIMATION_TOTAL_MS + 500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSplash]);

  function finishSplash() {
    try {
      localStorage.setItem(SPLASH_SEEN_KEY, "1");
    } catch {
      // Nothing to do if storage is unavailable — the splash will just
      // play again next visit, which is a harmless fallback.
    }
    setShowSplash(false);
  }

  // Only intercepts a plain left-click to play the exit animation before
  // navigating — a modified click (ctrl/cmd/middle-click, "open in new
  // tab") is left alone so the cards stay real, fully-functional links.
  function handleRoleClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (leavingTo) {
      e.preventDefault();
      return; // already navigating
    }
    e.preventDefault();
    setLeavingTo(href);
    window.setTimeout(() => router.push(href), EXIT_ANIMATION_MS);
  }

  if (showSplash === null) {
    return <main className="min-h-screen" style={{ background: "#F5FBF9" }} />;
  }

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-10 p-8 text-center"
      style={{ background: "#F5FBF9" }}
    >
      {showSplash && <SplashScreen onFinish={finishSplash} />}

      <div
        className={
          "flex flex-col items-center gap-3 transition-opacity duration-200 " +
          (leavingTo ? "opacity-0" : "animate-fade-in-up")
        }
      >
        <span className="block h-16 w-16 overflow-hidden rounded-2xl shadow-lg">
          <svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <radialGradient id="hbg" cx="32%" cy="28%" r="85%">
                <stop offset="0%" stopColor="#17a892" />
                <stop offset="55%" stopColor="#0f7a6c" />
                <stop offset="100%" stopColor="#0a5a4f" />
              </radialGradient>
            </defs>
            <rect width="512" height="512" fill="url(#hbg)" />
            <g
              transform="translate(256,264)"
              fill="none"
              stroke="#f5fbf9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="38" cy="-26" r="58" strokeWidth="42" />
              <path
                d="M 10 22 C -20 76, -78 104, -112 92 C -136 84, -146 62, -134 42"
                strokeWidth="42"
                fill="none"
              />
            </g>
          </svg>
        </span>
        <h1 className="text-4xl font-bold" style={{ color: "#0F7A6C" }}>
          مَوْعِد
        </h1>
        <p className="text-neutral-600">اختر كيف تريد استخدام موعد</p>
      </div>

      <div
        className={
          "grid w-full max-w-2xl grid-cols-1 gap-5 text-right transition-all duration-200 ease-out sm:grid-cols-2 " +
          (leavingTo ? "translate-y-2 opacity-0" : "animate-fade-in-up")
        }
        style={{ animationDelay: leavingTo ? undefined : "80ms" }}
      >
        <Link
          href="/subscribe"
          onClick={(e) => handleRoleClick(e, "/subscribe")}
          className="flex flex-col gap-2 rounded-2xl border p-7 shadow-sm transition hover:-translate-y-0.5"
          style={{ borderColor: "#d3ece9", background: "white" }}
        >
          <h2 className="text-lg font-bold" style={{ color: "#0F7A6C" }}>
            عيادة أو مركز تجميل
          </h2>
          <p className="text-sm leading-7 text-neutral-500">
            سجّل عيادتك أو مركز التجميل لإدارة الحجوزات والاستقبال وشاشة صالة الانتظار.
          </p>
        </Link>

        <Link
          href="/find"
          onClick={(e) => handleRoleClick(e, "/find")}
          className="flex flex-col gap-2 rounded-2xl border p-7 shadow-sm transition hover:-translate-y-0.5"
          style={{ borderColor: "#d3ece9", background: "white" }}
        >
          <h2 className="text-lg font-bold" style={{ color: "#0F7A6C" }}>
            مراجع
          </h2>
          <p className="text-sm leading-7 text-neutral-500">
            ابحث عن عيادتك واطلب موعدك مباشرة — بدون تسجيل حساب.
          </p>
        </Link>
      </div>
    </main>
  );
}
