"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppBackdrop from "../components/AppBackdrop";
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
// cards; and a static decorative backdrop (AppBackdrop, also rendered on
// /subscribe, /signup, and /clinic — see that component's own comment)
// that never remounts across any of these phases, so it stays visually
// constant the whole time. All pure CSS/Tailwind — no animation library was
// added, per
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

/** True when running as the installed PWA (Android/desktop's standard
 *  `display-mode: standalone` media feature, or iOS Safari's older
 *  nonstandard `navigator.standalone` for "Add to Home Screen" — no
 *  single check covers both). Wrapped in try/catch since matchMedia can
 *  throw in some restricted embed contexts; fails closed to "not
 *  standalone" (the safer default: worst case a returning installed-app
 *  user sees the intro once more, not a regular browser tab wrongly
 *  treated as the installed app). */
function isStandaloneDisplay(): boolean {
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
    if ((window.navigator as unknown as { standalone?: boolean }).standalone) return true;
  } catch {
    // fall through to false
  }
  return false;
}

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
    title: "إدارة المراكز (عيادات، مراكز تجميل ومراكز أخرى)",
  },
  {
    id: "find",
    href: "/find",
    title: "البحث عن خدمة أو حجز موعد",
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

  // Real bug fixed here: clicking a role card sets leaving=true right
  // before router.push() carries the visitor away to /signup or /find —
  // but nothing ever reset it. Two different mechanisms can bring back
  // that exact stale state on "رجوع", both closed by the two listeners
  // below rather than just one: (1) Next's router cache can reuse this
  // component instance instead of remounting it fresh on router.back(),
  // so a mount-only effect would never re-run to reset it; (2) real
  // mobile browsers commonly serve a back-navigation to a same-origin
  // page straight from the back-forward cache (bfcache) — a literal
  // frozen snapshot of the JS heap/DOM taken at the instant the visitor
  // left, mid-animation, thawed byte-for-byte on return. Either way the
  // symptom is identical (every role card stuck at opacity-0, invisible,
  // until a hard refresh forces a genuinely new mount/document load) —
  // popstate covers the first, pageshow (checking event.persisted, the
  // flag a bfcache restore sets) covers the second.
  useEffect(() => {
    function resetExitAnimation() {
      setLeaving(false);
      setSelectedHref(null);
    }
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) resetExitAnimation();
    }
    window.addEventListener("popstate", resetExitAnimation);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("popstate", resetExitAnimation);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

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
  // runs after) — decides once whether to show the intro and, if so,
  // switches to "intro" in the same pre-paint pass the FLIP effect below
  // also runs in, so a first-time visitor never sees the small "home" pose
  // flash before the big centered one takes over.
  useLayoutEffect(() => {
    if (decidedIntro.current) return;
    decidedIntro.current = true;
    // The installed app (Android TWA/APK, or Safari's "Add to Home
    // Screen") shows the intro on EVERY launch, no "already seen" check
    // at all — per the user's explicit, repeated request. This is
    // deliberately different from a regular browser tab, which still
    // shows it once (see below): opening an installed app is its own
    // distinct "launch" each time in a way that reopening a browser tab
    // to the same site isn't, and the user asked for exactly that
    // distinction.
    if (isStandaloneDisplay()) {
      setPhase("intro");
      return;
    }
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
      // Standalone (installed-app) launches never persist a "seen" flag —
      // they show the intro every time by design, see the effect above.
      if (isStandaloneDisplay()) {
        setPhase("home");
        return;
      }
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
      style={{ background: "#F2FBFC" }}
      onClick={introActive ? beginReveal : undefined}
    >
      <AppBackdrop />

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
                <stop offset="0%" stopColor="#2dd6dc" />
                <stop offset="55%" stopColor="#00adb5" />
                <stop offset="100%" stopColor="#007a80" />
              </radialGradient>
            </defs>
            <rect width="512" height="512" fill="url(#hbg)" />
            <g transform="translate(-78.2,2.9) scale(0.5068)">
              <path d="M 666.00,602.50 C 649.17,602.50 626.33,600.17 609.00,595.50 C 591.67,590.83 576.92,583.75 562.00,574.50 C 547.08,565.25 529.25,548.92 519.50,540.00 C 509.75,531.08 509.50,529.83 503.50,521.00 C 497.50,512.17 489.33,500.83 483.50,487.00 C 477.67,473.17 471.00,455.17 468.50,438.00 C 466.00,420.83 465.83,401.83 468.50,384.00 C 471.17,366.17 476.92,347.58 484.50,331.00 C 492.08,314.42 507.92,292.25 514.00,284.50 C 520.08,276.75 519.08,282.92 521.00,284.50 C 522.92,286.08 527.58,284.75 525.50,294.00 C 523.42,303.25 511.83,323.50 508.50,340.00 C 505.17,356.50 503.50,376.33 505.50,393.00 C 507.50,409.67 514.33,427.00 520.50,440.00 C 526.67,453.00 534.08,461.75 542.50,471.00 C 550.92,480.25 561.92,488.92 571.00,495.50 C 580.08,502.08 586.17,505.83 597.00,510.50 C 607.83,515.17 624.00,521.00 636.00,523.50 C 648.00,526.00 658.33,526.17 669.00,525.50 C 679.67,524.83 688.17,523.50 700.00,519.50 C 711.83,515.50 728.50,508.17 740.00,501.50 C 751.50,494.83 759.58,488.92 769.00,479.50 C 778.42,470.08 789.25,457.92 796.50,445.00 C 803.75,432.08 809.67,416.83 812.50,402.00 C 815.33,387.17 814.67,369.33 813.50,356.00 C 812.33,342.67 808.83,332.33 805.50,322.00 C 802.17,311.67 794.75,300.25 793.50,294.00 C 792.25,287.75 795.50,285.50 798.00,284.50 C 800.50,283.50 802.42,280.25 808.50,288.00 C 814.58,295.75 827.67,316.00 834.50,331.00 C 841.33,346.00 846.67,361.67 849.50,378.00 C 852.33,394.33 852.50,414.17 851.50,429.00 C 850.50,443.83 848.17,453.67 843.50,467.00 C 838.83,480.33 831.92,495.75 823.50,509.00 C 815.08,522.25 804.08,535.58 793.00,546.50 C 781.92,557.42 770.83,566.33 757.00,574.50 C 743.17,582.67 725.17,590.83 710.00,595.50 C 694.83,600.17 682.83,602.50 666.00,602.50 Z M 714.00,345.50 C 710.08,349.25 710.58,347.08 709.00,345.50 C 707.42,343.92 703.08,343.25 704.50,336.00 C 705.92,328.75 715.83,314.67 717.50,302.00 C 719.17,289.33 718.17,272.50 714.50,260.00 C 710.83,247.50 702.92,234.92 695.50,227.00 C 688.08,219.08 677.75,214.92 670.00,212.50 C 662.25,210.08 655.00,211.50 649.00,212.50 C 643.00,213.50 640.58,212.75 634.00,218.50 C 627.42,224.25 614.75,238.75 609.50,247.00 C 604.25,255.25 604.00,260.33 602.50,268.00 C 601.00,275.67 600.17,285.00 600.50,293.00 C 600.83,301.00 602.17,308.00 604.50,316.00 C 606.83,324.00 613.58,336.08 614.50,341.00 C 615.42,345.92 611.92,344.92 610.00,345.50 C 608.08,346.08 607.42,349.25 603.00,344.50 C 598.58,339.75 588.75,328.75 583.50,317.00 C 578.25,305.25 573.00,289.50 571.50,274.00 C 570.00,258.50 571.17,238.83 574.50,224.00 C 577.83,209.17 586.25,194.25 591.50,185.00 C 596.75,175.75 600.92,173.08 606.00,168.50 C 611.08,163.92 615.00,160.67 622.00,157.50 C 629.00,154.33 639.83,150.83 648.00,149.50 C 656.17,148.17 663.50,148.50 671.00,149.50 C 678.50,150.50 684.75,151.08 693.00,155.50 C 701.25,159.92 713.25,168.42 720.50,176.00 C 727.75,183.58 732.00,190.17 736.50,201.00 C 741.00,211.83 745.83,227.50 747.50,241.00 C 749.17,254.50 749.00,268.33 746.50,282.00 C 744.00,295.67 737.92,312.42 732.50,323.00 C 727.08,333.58 717.92,341.75 714.00,345.50 Z" fill="#f2fbfc" fillRule="evenodd" />
              <path d="M 491.00,849.50 C 474.67,851.67 463.33,850.33 450.00,847.50 C 436.67,844.67 422.25,839.42 411.00,832.50 C 399.75,825.58 389.92,816.42 382.50,806.00 C 375.08,795.58 369.50,783.00 366.50,770.00 C 363.50,757.00 362.67,741.67 364.50,728.00 C 366.33,714.33 370.58,700.42 377.50,688.00 C 384.42,675.58 395.58,662.08 406.00,653.50 C 416.42,644.92 427.83,639.50 440.00,636.50 C 452.17,633.50 467.83,634.33 479.00,635.50 C 490.17,636.67 500.08,640.75 507.00,643.50 C 513.92,646.25 518.83,649.17 520.50,652.00 C 522.17,654.83 523.25,659.25 517.00,660.50 C 510.75,661.75 492.67,658.50 483.00,659.50 C 473.33,660.50 465.33,663.83 459.00,666.50 C 452.67,669.17 450.75,669.75 445.00,675.50 C 439.25,681.25 428.92,693.25 424.50,701.00 C 420.08,708.75 419.00,713.17 418.50,722.00 C 418.00,730.83 418.75,745.58 421.50,754.00 C 424.25,762.42 428.58,767.75 435.00,772.50 C 441.42,777.25 450.67,781.00 460.00,782.50 C 469.33,784.00 481.00,783.17 491.00,781.50 C 501.00,779.83 472.83,794.83 520.00,772.50 C 567.17,750.17 723.83,670.50 774.00,647.50 C 824.17,624.50 806.50,636.67 821.00,634.50 C 835.50,632.33 847.50,632.33 861.00,634.50 C 874.50,636.67 890.25,641.42 902.00,647.50 C 913.75,653.58 923.25,660.75 931.50,671.00 C 939.75,681.25 947.50,696.67 951.50,709.00 C 955.50,721.33 956.50,732.00 955.50,745.00 C 954.50,758.00 949.33,776.17 945.50,787.00 C 941.67,797.83 937.42,803.25 932.50,810.00 C 927.58,816.75 924.08,821.58 916.00,827.50 C 907.92,833.42 896.00,842.00 884.00,845.50 C 872.00,849.00 855.67,849.33 844.00,848.50 C 832.33,847.67 821.58,843.25 814.00,840.50 C 806.42,837.75 801.08,834.42 798.50,832.00 C 795.92,829.58 797.75,827.58 798.50,826.00 C 799.25,824.42 797.42,822.75 803.00,822.50 C 808.58,822.25 822.33,825.50 832.00,824.50 C 841.67,823.50 852.58,820.58 861.00,816.50 C 869.42,812.42 876.42,806.92 882.50,800.00 C 888.58,793.08 894.50,784.83 897.50,775.00 C 900.50,765.17 901.83,750.83 900.50,741.00 C 899.17,731.17 895.08,722.42 889.50,716.00 C 883.92,709.58 875.75,705.08 867.00,702.50 C 858.25,699.92 848.67,699.00 837.00,700.50 C 825.33,702.00 845.17,689.17 797.00,711.50 C 748.83,733.83 599.00,811.50 548.00,834.50 C 497.00,857.50 507.33,847.33 491.00,849.50 Z" fill="#f2fbfc" fillRule="evenodd" />
            </g>
          </svg>
        </span>
        <h1
          className={"text-4xl font-bold " + (contentVisible ? "animate-fade-in-up" : "opacity-0")}
          style={{ color: "#00ADB5" }}
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
              <h2 className="text-lg font-bold" style={{ color: "#00ADB5" }}>
                {card.title}
              </h2>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
