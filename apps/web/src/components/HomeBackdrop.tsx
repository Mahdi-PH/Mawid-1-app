// Light, static (non-animated — "ثابتة") decorative background for the
// home screen, per the user's follow-up ask. Deliberately not tied to any
// of page.tsx's own state (splash showing, content revealed, leaving) —
// it's rendered once, unconditionally, so it stays visually constant
// across every phase that screen goes through: hidden under the opaque
// splash overlay while that plays (z-50, fully covers it), then a stable
// backdrop behind both the role-picker content and its exit transition.
//
// Purely decorative (aria-hidden, pointer-events-none) and reuses the
// existing brand teal + the exact logo mark already used everywhere else
// in this app, rather than inventing new imagery — two soft blurred glows
// echo the logo's own radial gradient, and the enlarged, very-low-opacity
// brand mark ties it directly to "فكرة التطبيق" without competing with the
// actual role cards for attention.
export default function HomeBackdrop() {
  return (
    // No negative z-index here on purpose: `main` (the parent) is only
    // `position: relative` with no z-index of its own, so it never forms
    // a stacking context — a negative z-index child would escape it and
    // paint behind main's own background instead of in front of it,
    // making the whole backdrop invisible. Simpler and robust instead:
    // this stays a plain z-index:auto absolutely-positioned layer, and
    // the actual content siblings in page.tsx get `relative` too, so both
    // land in the same paint layer and DOM order (this element first)
    // decides the stacking — no stacking-context plumbing required.
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        className="absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl"
        style={{ background: "#17A892", opacity: 0.12 }}
      />
      <div
        className="absolute -bottom-32 -left-20 h-80 w-80 rounded-full blur-3xl"
        style={{ background: "#0F7A6C", opacity: 0.1 }}
      />
      <svg viewBox="0 0 512 512" className="absolute -bottom-16 -right-16 h-64 w-64 opacity-[0.05]">
        <g transform="translate(256,264)" fill="none" stroke="#0F7A6C" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="38" cy="-26" r="58" strokeWidth="42" />
          <path d="M 10 22 C -20 76, -78 104, -112 92 C -136 84, -146 62, -134 42" strokeWidth="42" fill="none" />
        </g>
      </svg>
    </div>
  );
}
