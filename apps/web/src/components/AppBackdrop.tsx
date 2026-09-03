// Light, static (non-animated) decorative background — the app's uploaded
// reference photo (icons: stethoscope, doctor, hand mirror, scissors,
// razor, lotion bottle, a calendar with a confirmation checkmark, over a
// cream-to-teal gradient), spanning every stage of the app (home,
// /subscribe, /signup, /clinic, /find, /admin — each of those pages
// renders this same component, see its own file for how it's wired into
// that page's stacking).
//
// Two-layer fill, not a single object-cover <img>: the uploaded photo's
// icons sit close to its own left/right edges, and the photo's 2:3 aspect
// ratio is wider than most real phone screens — a single object-cover
// layer has to crop those edges to fill a narrower viewport, cutting into
// exactly those icons (reported by the user after the first version
// shipped). Fixed with the standard "blurred fill behind, untouched image
// in front" technique (the same one Instagram/Spotify use for a
// mismatched-aspect-ratio image): a heavily Gaussian-blurred copy of the
// SAME photo (backdrop-blur.jpg, generated once via Pillow — see the
// session notes for the exact command) fills the full viewport with
// object-cover; blurred past the point any shape is recognizable, so
// whatever it crops is imperceptible. The real, original photo sits on
// top of it at object-contain, so 100% of its actual content is always
// visible, never cropped, regardless of viewport aspect ratio — the
// tradeoff is a thin sliver of the blurred layer showing on two sides
// instead of the sharp photo touching every edge, which is the honest
// alternative to inventing new image content this session has no tool to
// generate.
export default function AppBackdrop() {
  return (
    // No negative z-index here on purpose: the parent must be `position:
    // relative` (or otherwise positioned) with no z-index of its own, so it
    // never forms a stacking context that would make a negative z-index
    // child escape it and paint behind the parent's own background instead
    // of in front of it — this was a real, caught-before-shipping bug the
    // first time this backdrop was built (see CLAUDE.md). Simpler and
    // robust instead: this stays a plain z-index:auto absolutely-positioned
    // layer, and the actual content sibling(s) on the page must also be
    // `position: relative` (or otherwise positioned) so both land in the
    // same paint layer — DOM order (this element first) then decides the
    // stacking, no stacking-context plumbing required. Every page that
    // renders this component follows that same two-part rule.
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/backdrop-blur.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/backdrop.jpg" alt="" className="absolute inset-0 h-full w-full object-contain" />
    </div>
  );
}
