"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SplashScreen, { SPLASH_ANIMATION_TOTAL_MS } from "../components/SplashScreen";
import HomeBackdrop from "../components/HomeBackdrop";

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
// Animations added here (see CLAUDE.md "Animations"): a one-time welcome
// splash (SplashScreen) on this browser's first-ever visit, a two-stage
// "pick, then leave" transition on the role cards (a quick selection pop
// on the chosen card, then the whole screen fades/settles away together)
// instead of an instant hard cut, and a static decorative backdrop
// (HomeBackdrop) that stays visually constant behind every phase this
// screen goes through. All pure CSS/Tailwind (tailwind.config.js
// keyframes) — no animation library was added, per the user's explicit
// choice — and none of it touches Firebase or any data fetch, so none of
// it can slow down anything this page actually depends on.
const SPLASH_SEEN_KEY = "mawid_splash_seen";
// Two-stage exit, deliberately longer/more distinctive than a plain
// instant cut per the user's follow-up ask: the clicked card briefly
// "pops" (SELECT_PULSE_MS) to confirm the choice, then the whole screen
// fades/settles away together (EXIT_MS) before the route actually changes.
const SELECT_PULSE_MS = 160;
const EXIT_MS = 380;

export default function Home() {
  const router = useRouter();
  // null = "haven't checked localStorage yet" (renders nothing but the
  // brand-colored background, so there's no flash of the role-picker
  // content before we know whether the splash should play first).
  const [showSplash, setShowSplash] = useState<boolean | null>(null);
  // Which card the user picked (drives the immediate "pop" + dimming the
  // other card), and whether the full-screen fade-out phase has started.
  const [selectedHref, setSelectedHref] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

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
    e.preventDefault();
    if (selectedHref) return; // already navigating
    setSelectedHref(href);
    window.setTimeout(() => {
      setLeaving(true);
      window.setTimeout(() => router.push(href), EXIT_MS);
    }, SELECT_PULSE_MS);
  }

  if (showSplash === null) {
    return (
      <main className="relative min-h-screen" style={{ background: "#F5FBF9" }}>
        <HomeBackdrop />
      </main>
    );
  }

  return (
    <main
      className="relative flex min-h-screen flex-col items-center justify-center gap-10 p-8 text-center"
      style={{ background: "#F5FBF9" }}
    >
      <HomeBackdrop />

      {showSplash && <SplashScreen onFinish={finishSplash} />}

      <div
        className={
          "relative flex flex-col items-center gap-3 transition-all duration-300 ease-out " +
          (leaving ? "-translate-y-2 opacity-0" : "animate-fade-in-up")
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
          "relative grid w-full max-w-2xl grid-cols-1 gap-5 text-right sm:grid-cols-2 " +
          (leaving ? "" : "animate-fade-in-up")
        }
        style={{ animationDelay: leaving ? undefined : "80ms" }}
      >
        {(
          [
            {
              href: "/subscribe",
              title: "عيادة أو مركز تجميل",
              desc: "سجّل عيادتك أو مركز التجميل لإدارة الحجوزات والاستقبال وشاشة صالة الانتظار.",
              delay: 0,
            },
            {
              href: "/find",
              title: "مراجع",
              desc: "ابحث عن عيادتك واطلب موعدك مباشرة — بدون تسجيل حساب.",
              delay: 60,
            },
          ] as const
        ).map((card) => {
          const isSelected = selectedHref === card.href;
          const isDimmed = selectedHref !== null && !isSelected;
          return (
            <Link
              key={card.href}
              href={card.href}
              onClick={(e) => handleRoleClick(e, card.href)}
              className={
                "flex flex-col gap-2 rounded-2xl border p-7 shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 " +
                (leaving
                  ? "translate-y-3 scale-95 opacity-0"
                  : isSelected
                    ? "scale-[1.03] shadow-lg ring-2 ring-brand-500"
                    : isDimmed
                      ? "scale-95 opacity-50"
                      : "")
              }
              style={{ borderColor: "#d3ece9", background: "white" }}
            >
              <h2 className="text-lg font-bold" style={{ color: "#0F7A6C" }}>
                {card.title}
              </h2>
              <p className="text-sm leading-7 text-neutral-500">{card.desc}</p>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
