// Server Component wrapper — see admin/layout.tsx's comment for why this
// has to be a Server Component: `dynamic` route-segment config is a no-op
// in a "use client" file, and this page reads live Firebase config on
// load, which next build would otherwise try (and fail) to prerender.
export const dynamic = "force-dynamic";

import SignupClient from "./SignupClient";

export default function SignupPage() {
  return <SignupClient />;
}
