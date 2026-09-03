"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import HomeBackdrop from "../components/HomeBackdrop";
import { isAdminUser, isConfiguredAdminEmail, onAuthChange } from "../lib/firebase/auth";

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
// Animations added here (see CLAUDE.md "Animations"): a first-launch
// "opening" pose where the logo appears large and centered over the
// persistent backdrop, then glides back into its normal small header spot
// (a FLIP-style shared-element transform on the SAME logo element — see
// the useLayoutEffect below — not a separate splash component crossfading
// into a different one). This pose holds indefinitely — no auto-timer —
// and only a tap anywhere on the screen advances it, per the user's
// explicit ask; a two-stage "pick, then leave" transition on the role
// cards; and a static decorative backdrop (HomeBackdrop) that never
// remounts across any of these phases, so it stays visually constant the
// whole time. All pure CSS/Tailwind — no animation library was added, per
// the user's explicit choice — and none of it touches Firebase or any
// data fetch, so none of it can slow down anything this page actually
// depends on.
const SPLASH_SEEN_KEY = "mawid_splash_seen";
const HERO_SIZE_PX = 112; // the logo's size while it's the big, centered "opening" mark
const REVEAL_MS = 650; // how long the logo takes to glide back into its header spot
const HINT_DELAY_MS = 650; // delay before the "tap to continue" hint fades in
// Two-stage exit on the role cards: the clicked card briefly "pops"
// (SELECT_PULSE_MS) to confirm the choice, then the whole screen
// fades/settles away together (EXIT_MS) before the route actually changes.
const SELECT_PULSE_MS = 160;
const EXIT_MS = 380;

type Phase = "intro" | "revealing" | "home";

const ROLE_CARDS = [
  {
    id: "center",
    // Default/fallback href for a not-signed-in visitor (also what static
    // export prerenders): straight to account creation/login. Overridden
    // per-visitor by `centerHref` state below once auth state resolves —
    // an already-signed-in clinic account skips this and goes straight to
    // /clinic, an admin to /admin, so the account "يبقى مفتوحاً" (stays
    // signed in) instead of being sent back through the signup/login form
    // it already passed.
    href: "/signup",
    title: "المركز: عيادة طبيب، مركز تجميل أو صالون حلاقة",
    desc: "سجّل مركزك لإدارة الحجوزات والاستقبال وشاشة صالة الانتظار.",
  },
  {
    id: "find",
    href: "/find",
    title: "المراجع أو الزبون",
    desc: "ابحث عن مركزك واطلب موعدك مباشرة — بدون تسجيل حساب.",
  },
] as const;

export default function Home() {
  const router = useRouter();
  // Defaults to "home" — the exact same fully-rendered, fully-functional
  // page (small logo, real <Link> cards) that static export prerenders and
  // that a slow/failed JS load falls back to. A previous version defaulted
  // to a `null` phase that rendered nothing but the backdrop until an
  // ordinary useEffect (which only runs *after* first paint) decided
  // intro-vs-home — meaning every visitor briefly saw a blank page with no
  // logo and a dead tap gesture, and on a slow connection or a delayed
  // hydration that window could stretch out enough to look like the
  // feature was simply missing. See CLAUDE.md "Animations" for the
  // user-reported bug this replaced.
  const [phase, setPhase] = useState<Phase>("home");
  const [showHint, setShowHint] = useState(false);
  const [selectedHref, setSelectedHref] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  // Where the "المركز" card actually goes — starts at the signed-out
  // default (/signup) and updates once auth state resolves, so an
  // already-signed-in clinic/admin account is sent straight to its real
  // dashboard instead of back through the login form it already passed.
  const [centerHref, setCenterHref] = useState("/signup");
  const logoRef = useRef<HTMLSpanElement>(null);
  const decidedIntro = useRef(false);

  useEffect(() => {
    return onAuthChange(async (user) => {
      if (!user || user.isAnonymous) {
        // Signed out, or only a patient's anonymous session (created by
        // ensurePatientSession() the moment they book) — neither is a
        // clinic/admin account, so the card still goes to /signup.
        setCenterHref("/signup");
        return;
      }
      if (user.email && isConfiguredAdminEmail(user.email) && (await isAdminUser(user))) {
        setCenterHref("/admin");
        return;
      }
      setCenterHref("/clinic");
    });
  }, []);

  // Runs before the browser paints (unlike a plain useEffect, which only
  // runs after) — decides once whether this is a first visit and, if so,
  // switches to "intro" in the same pre-paint pass the FLIP effect below
  // also runs in, so a first-time visitor never sees the small "home" pose
  // flash before the big centered one takes over.
  useLayoutEffect(() => {
    if (decidedIntro.current) return;
    decidedIntro.current = true;
    // ?intro=1 forces the opening pose regardless of the "already seen"
    // flag — a stable link for testing/demoing the first-launch effect on
    // a browser that has already visited before, without needing to clear
    // site data each time. Read directly off window.location rather than
    // Next's useSearchParams() so this stays a plain effect (no <Suspense>
    // boundary needed just for a debug flag).
    const forceIntro = new URLSearchParams(window.location.search).get("intro") === "1";
    let seen = true;
    try {
      seen = localStorage.getItem(SPLASH_SEEN_KEY) === "1";
    } catch {
      // Storage blocked (private mode, etc.) — fail open to "already seen"
      // rather than replaying the opening pose on every single visit.
    }
    if (forceIntro || !seen) setPhase("intro");
  }, []);

  // FLIP transform: the logo lives in exactly one DOM spot (its normal,
  // small header position) the whole time — this measures that natural
  // position the instant it mounts, then fakes a large-and-centered
  // "opening" pose with a transform applied *before* any transition is
  // enabled (so there's no visible jump), and only then turns the
  // transition on so the later return to identity (beginReveal) glides
  // smoothly instead of snapping straight there.
  useLayoutEffect(() => {
    if (phase !== "intro" || !logoRef.current) return;
    const el = logoRef.current;
    const rect = el.getBoundingClientRect();
    const scale = HERO_SIZE_PX / rect.width;
    const dx = window.innerWidth / 2 - (rect.left + rect.width / 2);
    const dy = window.innerHeight / 2 - (rect.top + rect.height / 2);
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    // Force a reflow so the transition-off write above is committed on its
    // own before we re-enable transitions — otherwise the browser can
    // coalesce both style writes into one recalc and skip animating later.
    void el.offsetHeight;
    el.style.transition = `transform ${REVEAL_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`;
  }, [phase]);

  useEffect(() => {
    if (phase !== "intro") return;
    // No auto-continue timer here on purpose — the opening pose holds
    // indefinitely and only a tap advances it, per the user's explicit
    // ask ("الانتقال منها فقط بعد الضغط على الشاشة").
    const hint = window.setTimeout(() => setShowHint(true), HINT_DELAY_MS);
    return () => window.clearTimeout(hint);
  }, [phase]);

  function beginReveal() {
    if (phase !== "intro") return;
    setShowHint(false);
    setPhase("revealing");
    // Transition was already armed by the layout effect above — changing
    // the transform back to identity here is what actually animates the
    // logo gliding from its big centered pose back to its real spot.
    if (logoRef.current) logoRef.current.style.transform = "translate(0, 0) scale(1)";
    window.setTimeout(() => {
      try {
        localStorage.setItem(SPLASH_SEEN_KEY, "1");
      } catch {
        // Nothing to do if storage is unavailable — the opening pose will
        // just replay next visit, which is a harmless fallback.
      }
      setPhase("home");
    }, REVEAL_MS);
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

  const introActive = phase === "intro";
  const contentVisible = phase !== "intro";

  return (
    <main
      className="relative flex min-h-screen flex-col items-center justify-center gap-10 p-8 text-center"
      style={{ background: "#F5FBF9" }}
      onClick={introActive ? beginReveal : undefined}
    >
      <HomeBackdrop />

      {/* animate-hero-ring's own keyframes bake in translate(-50%,-50%)
          for centering (see tailwind.config.js), so no separate translate
          utility is needed here — it would just be overridden by the
          animation's own transform value anyway. */}
      {introActive && (
        <span
          className="pointer-events-none fixed left-1/2 top-1/2 h-32 w-32 animate-hero-ring rounded-full"
          style={{ background: "radial-gradient(circle, rgba(23,168,146,0.5) 0%, rgba(23,168,146,0) 70%)" }}
        />
      )}

      {introActive && (
        <p
          className={
            "pointer-events-none fixed bottom-16 left-1/2 -translate-x-1/2 text-sm text-neutral-400 transition-opacity duration-500 " +
            (showHint ? "opacity-100" : "opacity-0")
          }
        >
          المس الشاشة للمتابعة
        </p>
      )}

      <div className="relative flex flex-col items-center gap-3">
        <span
          ref={logoRef}
          className="block h-16 w-16 overflow-hidden rounded-2xl shadow-lg"
          style={{ willChange: "transform" }}
        >
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
        <h1
          className={"text-4xl font-bold " + (contentVisible ? "animate-fade-in-up" : "opacity-0")}
          style={{ color: "#0F7A6C" }}
        >
          مَوْعِد
        </h1>
        <p
          className={"text-neutral-600 " + (contentVisible ? "animate-fade-in-up" : "opacity-0")}
          style={{ animationDelay: contentVisible ? "60ms" : undefined }}
        >
          اختر كيف تريد استخدام موعد
        </p>
      </div>

      <div
        className={
          "relative grid w-full max-w-2xl grid-cols-1 gap-5 text-right sm:grid-cols-2 " +
          (contentVisible && !leaving ? "animate-fade-in-up" : contentVisible ? "" : "pointer-events-none opacity-0")
        }
        style={{ animationDelay: contentVisible && !leaving ? "120ms" : undefined }}
      >
        {ROLE_CARDS.map((card) => {
          const href = card.id === "center" ? centerHref : card.href;
          const isSelected = selectedHref === href;
          const isDimmed = selectedHref !== null && !isSelected;
          return (
            <Link
              key={card.id}
              href={href}
              onClick={(e) => handleRoleClick(e, href)}
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
