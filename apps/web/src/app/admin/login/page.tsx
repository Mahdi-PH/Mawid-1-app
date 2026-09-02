"use client";

// Forced dynamic (no static prerendering) via admin/layout.tsx, which this
// route is nested under.

import { useState } from "react";
import { signInWithEmail } from "../../../lib/firebase/auth";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // No router.replace() here on success — AdminLayoutClient's own
      // auth-state effect is the single place that navigates once it
      // confirms (asynchronously) this user really is an admin. Racing
      // that check with a second, independent navigation here is exactly
      // what caused the login-that-bounces-back bug; see that file's
      // comment.
      await signInWithEmail(email, password);
    } catch (err) {
      // Only auth/* codes (wrong password, no such user, ...) are genuinely
      // "check your credentials" — anything else (network unreachable, a
      // misconfigured Firebase project) is a real problem worth showing
      // as-is rather than burying under a misleading "wrong password".
      const code = (err as { code?: string })?.code ?? "";
      setError(
        code.startsWith("auth/")
          ? "بيانات الدخول غير صحيحة."
          : `تعذّر تسجيل الدخول: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-lg font-bold text-brand-700">تسجيل دخول المدير</h1>
        <label className="mb-3 block text-sm">
          البريد الإلكتروني
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2"
          />
        </label>
        <label className="mb-4 block text-sm">
          كلمة المرور
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2"
          />
        </label>
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-brand-600 py-2 font-bold text-white disabled:opacity-60"
        >
          {busy ? "…" : "دخول"}
        </button>
      </form>
    </div>
  );
}
