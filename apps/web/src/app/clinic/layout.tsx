"use client";

// Gate for /clinic/*: the reception dashboard/waiting-room-TV/schedule-
// settings screen for a signed-in clinic/beauty-center account — the one
// missing piece that meant a clinic could sign up via /signup and get
// approved but had nowhere real to go afterward (see CLAUDE.md "Real
// clinic dashboard"). Same single-navigating-effect pattern as
// admin/layout.tsx, for the same reason: a page calling router.push()
// itself right after auth resolves races this effect.
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { consumeIntentionalSignOut, onAuthChange } from "../../lib/firebase/auth";
import type { User } from "firebase/auth";

type Status = "checking" | "signed-out" | "ok";

export default function ClinicLayout({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    return onAuthChange((user: User | null) => {
      setStatus(user && !user.isAnonymous ? "ok" : "signed-out");
    });
  }, []);

  useEffect(() => {
    if (status === "signed-out") {
      // A deliberate sign-out (the settings tab's "تسجيل خروج من الحساب"
      // button) should land on the home screen, not the login form — an
      // expired/never-started session should still go to /signup. Both
      // look identical here (auth state -> null), so the sign-out button
      // marks itself first; see auth.ts. `?mode=login` skips /signup's
      // own new center-type-selection step (see SignupClient.tsx) — a
      // returning clinic owner needs the login form directly, not the
      // type picker a fresh signup starts from.
      router.replace(consumeIntentionalSignOut() ? "/" : "/signup?mode=login");
    }
  }, [status, pathname, router]);

  if (status === "checking") {
    return <div className="p-8 text-center text-gray-500">جارٍ التحقق من الصلاحية…</div>;
  }
  if (status === "signed-out") return null; // redirecting

  return <div dir="rtl">{children}</div>;
}
