"use client";

// Root-level fallback — only ever renders if an error escapes even
// app/error.tsx (e.g. a crash inside app/layout.tsx itself, before any
// route segment's own boundary exists to catch it). Next.js requires this
// file to render its own complete <html>/<body>, since it fully replaces
// the root layout when active — it has no parent layout left to rely on.
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error boundary caught:", error);
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      <body style={{ margin: 0 }}>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            backgroundColor: "#F2FBFC",
            padding: 32,
            textAlign: "center",
            fontFamily: "sans-serif",
          }}
        >
          <div style={{ fontSize: 40 }} aria-hidden>
            ⚠️
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1f2937", margin: 0 }}>حدث خطأ غير متوقع</h1>
          <p style={{ maxWidth: 320, fontSize: 14, color: "#6b7280", margin: 0 }}>
            تعذّر تشغيل التطبيق. حاول إعادة تحميل الصفحة.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 700,
              color: "#fff",
              backgroundColor: "#00ADB5",
              border: "none",
              cursor: "pointer",
            }}
          >
            إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  );
}
