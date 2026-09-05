"use client";

// Foreground account-status alerts for /clinic — NOT Firebase Cloud
// Messaging. A real push notification that arrives even after the app/tab
// is fully closed needs FCM plus a server-side trigger (a Cloud Function
// reacting to admin's approve/reject write) — Cloud Functions require the
// paid Blaze plan to deploy at all, the exact same wall this project has
// already hit for Firebase Storage and Phone Auth (see CLAUDE.md). Rather
// than build unusable token/service-worker plumbing with no way to ever
// trigger a send, this uses the plain browser Notification API instead:
// as long as the clinic's own /clinic tab (or installed PWA/TWA) is open
// — even backgrounded, not literally closed — its live
// watchClinicByOwner() listener (see firestore.ts) fires the moment
// admin's write lands, and this shows a real OS-level notification for it.
// Disclosed limitation, not hidden: this cannot reach a fully closed app.
export function canRequestNotificationPermission(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | null {
  return canRequestNotificationPermission() ? Notification.permission : null;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | null> {
  if (!canRequestNotificationPermission()) return null;
  try {
    return await Notification.requestPermission();
  } catch {
    return null;
  }
}

export function notifyClinicStatusChange(status: "approved" | "rejected", clinicName: string): void {
  if (!canRequestNotificationPermission() || Notification.permission !== "granted") return;
  try {
    const title = status === "approved" ? "تمت الموافقة على حسابك" : "تم رفض طلب التسجيل";
    const body =
      status === "approved"
        ? `تمت الموافقة على حساب "${clinicName}" — يمكنك الآن استخدام لوحة الاستقبال.`
        : `تعذّر تفعيل حساب "${clinicName}". تواصل مع الإدارة لمزيد من التفاصيل.`;
    new Notification(title, { body, icon: "/brand/icon-192.png" });
  } catch (err) {
    console.error("Failed to show status-change notification:", err);
  }
}
