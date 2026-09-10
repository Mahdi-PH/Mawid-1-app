// Tiny module-level pub/sub so the admin stats dashboard
// (app/admin/page.tsx) picks up changes made inside AdminSettingsDrawer —
// a sibling under admin/layout.tsx, not a parent/child of the stats page,
// since the drawer now owns the pending/rejected/subscriptions/users data
// that used to live on the stats page itself. Approve/reject/renew/delete
// calls notifyAdminDataChanged() once they succeed; admin/page.tsx
// subscribes via onAdminDataChanged() to re-fetch its own counts, rather
// than going stale until the page is next remounted.
type Listener = () => void;
const listeners = new Set<Listener>();

export function notifyAdminDataChanged(): void {
  listeners.forEach((l) => l());
}

export function onAdminDataChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
