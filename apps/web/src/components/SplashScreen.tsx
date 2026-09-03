"use client";

// First-launch welcome animation: the logo fades in with a light scale-up
// (splash-logo-in, see tailwind.config.js), holds briefly, then the whole
// overlay fades out (splash-out) to reveal the real home screen underneath.
// Pure CSS keyframes — no animation library — so this costs nothing at
// runtime beyond one timer and never touches Firebase/data loading, which
// keeps starting on the home screen underneath completely unaffected.
//
// "First launch" is tracked with a plain localStorage flag (SPLASH_SEEN_KEY)
// — the same lightweight per-browser persistence already used elsewhere in
// this app's client-only screens. HomeGate (app/page.tsx) owns reading that
// flag before first paint; this component only renders once HomeGate has
// already decided the splash should play, and calls onFinish when its
// animation is done so HomeGate can reveal the role-picker content.
const HOLD_MS = 550;
const FADE_OUT_MS = 350;

export default function SplashScreen({ onFinish }: { onFinish: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex animate-splash-out flex-col items-center justify-center gap-4"
      style={{ background: "#F5FBF9", animationDelay: `${HOLD_MS}ms` }}
      // animationend bubbles, so without this guard the logo/wordmark's own
      // splash-logo-in animations (which finish first) would fire this too.
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) onFinish();
      }}
    >
      <span className="block h-20 w-20 animate-splash-logo-in overflow-hidden rounded-2xl shadow-lg">
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
      <h1
        className="animate-splash-logo-in text-2xl font-bold"
        style={{ color: "#0F7A6C", animationDelay: "80ms" }}
      >
        مَوْعِد
      </h1>
    </div>
  );
}

export const SPLASH_ANIMATION_TOTAL_MS = HOLD_MS + FADE_OUT_MS;
