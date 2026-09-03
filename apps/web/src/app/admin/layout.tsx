"use client";

// A static export (see next.config.js output:"export") means there's no
// server left to do per-request auth gating with anyway, so this is
// purely a client component now — no Server Component wrapper needed
// (that split existed only to host `dynamic = "force-dynamic"`, which is
// incompatible with static export and no longer necessary now that real
// Firebase env values are baked in at build time instead of missing).
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import BackButton from "../../components/BackButton";
import AppBackdrop from "../../components/AppBackdrop";
import {
  consumeIntentionalSignOut,
  isAdminUser,
  markIntentionalSignOut,
  onAuthChange,
  signOutUser,
} from "../../lib/firebase/auth";
import type { User } from "firebase/auth";

type Status = "checking" | "signed-out" | "not-admin" | "ok";

/** Gate for every /admin/* route: redirects to the unified /signup page
 *  (which itself becomes a plain sign-in when the entered email matches
 *  the configured admin address — see app/signup) unless the signed-in
 *  user carries the admin custom claim (see auth.ts isAdminUser and
 *  scripts/seed-admin.mjs, the only place that claim is ever set). There
 *  is deliberately no separate admin-only login page anymore — /admin/login
 *  is kept only as a redirect for old links (see that file). */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    return onAuthChange(async (user: User | null) => {
      if (!user) {
        setStatus("signed-out");
        return;
      }
      setStatus((await isAdminUser(user)) ? "ok" : "not-admin");
    });
  }, []);

  // This effect is the ONLY place that navigates based on auth state — an
  // auth page used to also call router.replace("/admin") itself right
  // after a successful sign-in, which raced this effect: status briefly
  // still read "signed-out" (onAuthChange's async isAdminUser() check
  // hadn't resolved yet) at the exact moment pathname flipped to "/admin",
  // bouncing straight back before the real "ok" update ever landed — a
  // login that visibly "worked" (network calls all succeeded) but never
  // actually let you in. Funneling navigation through this single effect,
  // driven only by `status`, removes the race.
  useEffect(() => {
    if (status === "signed-out" && pathname !== "/admin/login") {
      // A deliberate sign-out (the header's own "تسجيل خروج" button) should
      // land on the home screen, not the login form — an expired/never-
      // started session should still go to /signup. Both look identical
      // here (auth state -> null), so the sign-out button marks itself
      // first; see auth.ts and the identical pattern already used for
      // /clinic's own sign-out.
      router.replace(consumeIntentionalSignOut() ? "/" : "/signup");
    }
    if (status === "ok" && pathname === "/admin/login") router.replace("/admin");
  }, [status, pathname, router]);

  async function handleSignOut() {
    markIntentionalSignOut();
    await signOutUser();
  }

  if (pathname === "/admin/login") return <>{children}</>;

  if (status === "checking") {
    return (
      <div className="relative min-h-screen">
        <AppBackdrop />
        <div className="relative p-8 text-center text-gray-500">جارٍ التحقق من الصلاحية…</div>
      </div>
    );
  }
  if (status === "not-admin") {
    return (
      <div className="relative min-h-screen">
        <AppBackdrop />
        <div className="relative p-8 text-center text-red-600">
          هذا الحساب لا يملك صلاحية المدير (admin). سجّل الدخول بحساب المدير المُهيَّأ عبر
          scripts/seed-admin.mjs.
        </div>
      </div>
    );
  }
  if (status === "signed-out") return null; // redirecting

  return (
    <div dir="rtl" className="relative min-h-screen bg-gray-50">
      <AppBackdrop />
      <header className="relative border-b bg-white px-6 py-4">
        <div className="mb-2 flex items-center justify-between">
          <BackButton
            fallbackHref={pathname === "/admin" ? "/" : "/admin"}
            className="block text-sm text-brand-600 hover:underline"
          />
          <button
            type="button"
            onClick={handleSignOut}
            className="text-sm text-red-600 hover:underline"
          >
            تسجيل خروج
          </button>
        </div>
        <h1 className="text-lg font-bold text-brand-700">لوحة تحكم المدير — موعد</h1>
      </header>
      <main className="relative p-6">{children}</main>
    </div>
  );
}
