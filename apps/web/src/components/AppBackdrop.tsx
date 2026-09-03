// Light, static (non-animated) decorative background — the app's uploaded
// reference photo (icons: stethoscope, doctor, hand mirror, scissors,
// razor, lotion bottle, a calendar with a confirmation checkmark, over a
// cream-to-teal gradient) rendered once per page with object-fit: cover so
// it fills any phone viewport without distortion, cropping only the outer
// edges rather than stretching. Spans every stage of the app (home,
// /subscribe, /signup, /clinic, /find, /admin — each of those pages
// renders this same component, see its own file for how it's wired into
// that page's stacking).
//
// Single layer by the user's explicit choice, after trying a two-layer
// blurred-fill-behind fix for the image's own edge icons getting cropped
// on narrow phones (see CLAUDE.md) — the user preferred to solve that by
// re-exporting the source photo at phone-safe dimensions instead of
// carrying the extra blurred asset/layer indefinitely. Whoever supplies
// the next backdrop.jpg should follow CLAUDE.md's dimension/safe-margin
// guidance so this single `object-cover` layer doesn't crop into it again.
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
      <img src="/brand/backdrop.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
    </div>
  );
}
