"use client";

// React error boundary for every route segment under app/ — the direct
// fix for "the whole app UI disappears (blank/white screen) on refresh or
// a data refetch". Before this file existed, this project had NO error
// boundary anywhere (confirmed by a repo-wide search for error.tsx/
// global-error.tsx that found none) — so ANY uncaught exception thrown
// during a render (a live Firestore onSnapshot callback calling setState
// with data a component doesn't guard against, a chunk-load failure re-
// thrown into React, anything) unmounted the ENTIRE React tree with
// nothing left to show. Next.js's App Router renders this boundary
// client-side regardless of static export (output: "export" in
// next.config.js), so this is a real, low-risk defensive layer, not a
// server feature this project can't use.
import { useEffect } from "react";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route error boundary caught:", error);
  }, [error]);

  return (
    <div
      dir="rtl"
      className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center"
      style={{ backgroundColor: "#F2FBFC" }}
    >
      <div aria-hidden className="text-4xl">
        ⚠️
      </div>
      <h1 className="text-lg font-bold text-gray-800">حدث خطأ غير متوقع</h1>
      <p className="max-w-sm text-sm text-gray-500">
        تعذّر عرض هذه الصفحة. يمكنك إعادة المحاولة الآن، أو العودة إلى الرئيسية إذا استمرت المشكلة.
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg px-5 py-2.5 text-sm font-bold text-white"
          style={{ backgroundColor: "#00ADB5" }}
        >
          إعادة المحاولة
        </button>
        <a href="/" className="rounded-lg border px-5 py-2.5 text-sm font-bold text-gray-600">
          الرئيسية
        </a>
      </div>
    </div>
  );
}
