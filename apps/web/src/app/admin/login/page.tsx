"use client";

// Kept only so old bookmarks/links to /admin/login still land somewhere —
// the real, unified sign-in/signup UI now lives at /signup (see that
// route and AdminLayoutClient's comment for why there's no separate
// admin-only login page anymore).
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/signup");
  }, [router]);
  return null;
}
