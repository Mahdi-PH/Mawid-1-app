"use client";

// Kept only so old bookmarks/links to /admin/login still land somewhere —
// the real, unified sign-in/signup UI now lives at /signup (see that
// route and AdminLayoutClient's comment for why there's no separate
// admin-only login page anymore). `?mode=login` skips /signup's own new
// center-type-selection step (see SignupClient.tsx) — anyone landing here
// wants to sign in, not start a fresh center signup.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/signup?mode=login");
  }, [router]);
  return null;
}
