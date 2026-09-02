"use client";

// force-dynamic isn't needed (or allowed) anymore — see admin/layout.tsx's
// comment: real Firebase env values are now baked in at build time, and
// this app builds as a static export (next.config.js output:"export"),
// which is incompatible with that route-segment config anyway.
import SignupClient from "./SignupClient";

export default function SignupPage() {
  return <SignupClient />;
}
