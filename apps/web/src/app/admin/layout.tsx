// Server Component wrapper — route segment config (`dynamic`) only takes
// effect from a Server Component, not from a "use client" file, so the
// actual auth-gate logic lives in AdminLayoutClient and this file's only
// job is opting the whole /admin/* subtree out of static prerendering
// (every admin page reads live Firebase auth state on load, and `next
// build` would otherwise try to prerender it with no signed-in user and,
// worse, before any Firebase env vars necessarily exist at build time).
export const dynamic = "force-dynamic";

import AdminLayoutClient from "./AdminLayoutClient";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
