"use client";

// First-launch welcome animation, given a more distinctive/premium feel
// per the user's follow-up ask (longer, clearer motion than the original
// plain fade+scale): the logo bounces in (splash-logo-in, slight
// overshoot) with a soft pulsing teal halo behind it (splash-ring), the
// wordmark settles in a beat later, three small loading dots pulse
// underneath while the screen holds, then the whole overlay fades out
// (splash-out) to reveal the real home screen. Still pure CSS keyframes
// (tailwind.config.js) — no animation library — so this costs nothing at
// runtime beyond one timer and never touches Firebase/data loading.
//
// "First launch" is tracked with a plain localStorage flag (SPLASH_SEEN_KEY,
// see app/page.tsx's HomeGate logic) — the same lightweight per-browser
// persistence already used elsewhere in this app's client-only screens.
// This component only renders once page.tsx has already decided the splash
// should play, and calls onFinish when its own exit animation ends so the
// role-picker content can be revealed.
const LOGO_ENTRANCE_MS = 650;
const WORDMARK_DELAY_MS = 180;
const WORDMARK_DURATION_MS = 480;
const DOTS_DELAY_MS = 700;
const HOLD_AFTER_ENTRANCE_MS = 500;
const FADE_OUT_MS = 420;

const ENTRANCE_END_MS = Math.max(LOGO_ENTRANCE_MS, WORDMARK_DELAY_MS + WORDMARK_DURATION_MS);
const EXIT_DELAY_MS = ENTRANCE_END_MS + HOLD_AFTER_ENTRANCE_MS;

// Exported so app/page.tsx's fallback timer (in case animationend never
// fires — e.g. a backgrounded tab) waits at least this long before it
// force-dismisses the splash.
export const SPLASH_ANIMATION_TOTAL_MS = EXIT_DELAY_MS + FADE_OUT_MS;

export default function SplashScreen({ onFinish }: { onFinish: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex animate-splash-out flex-col items-center justify-center gap-4"
      style={{ background: "#F5FBF9", animationDelay: `${EXIT_DELAY_MS}ms` }}
      // animationend bubbles, so without this guard the logo/ring/wordmark/
      // dots' own animations (which finish first, or loop forever for the
      // dots) would fire this too.
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) onFinish();
      }}
    >
      <div className="relative flex h-24 w-24 items-center justify-center">
        <span
          className="absolute h-24 w-24 animate-splash-ring rounded-full"
          style={{ background: "radial-gradient(circle, rgba(23,168,146,0.55) 0%, rgba(23,168,146,0) 70%)" }}
        />
        <span className="relative block h-20 w-20 animate-splash-logo-in overflow-hidden rounded-2xl shadow-lg">
          <svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <radialGradient id="sbg" cx="32%" cy="28%" r="85%">
                <stop offset="0%" stopColor="#17a892" />
                <stop offset="55%" stopColor="#0f7a6c" />
                <stop offset="100%" stopColor="#0a5a4f" />
              </radialGradient>
            </defs>
            <rect width="512" height="512" fill="url(#sbg)" />
            <g transform="translate(256,264)" fill="none" stroke="#f5fbf9" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="38" cy="-26" r="58" strokeWidth="42" />
              <path d="M 10 22 C -20 76, -78 104, -112 92 C -136 84, -146 62, -134 42" strokeWidth="42" fill="none" />
            </g>
          </svg>
        </span>
      </div>

      <h1
        className="animate-fade-in-up text-2xl font-bold"
        style={{ color: "#0F7A6C", animationDelay: `${WORDMARK_DELAY_MS}ms` }}
      >
        مَوْعِد
      </h1>

      <div className="flex gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-splash-dot rounded-full"
            style={{ background: "#17A892", animationDelay: `${DOTS_DELAY_MS + i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
