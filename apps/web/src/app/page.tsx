import Link from "next/link";

// Matches the branded two-sided home screen already iterated in the demo
// artifact (see CLAUDE.md "Two-sided product direction") - logo mark,
// wordmark, teal gradient, role cards - instead of the placeholder MVP
// homepage this used to be (a bare "لوحة الاستقبال"/"شاشة صالة الانتظار"
// pair pointing at apps/server routes that aren't hosted anywhere). مراجع
// now routes to /find (real, Firestore-backed patient directory + booking,
// no account) - see CLAUDE.md "Real patient-facing directory + booking
// (apps/web/src/app/find/)" for what it does and doesn't cover. عيادة أو
// مركز تجميل routes through /subscribe first (the demo artifact's own
// flow: role picker -> subscription info screen -> signup/login), not
// straight to /signup.
export default function Home() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-10 p-8 text-center"
      style={{ background: "#F5FBF9" }}
    >
      <div className="flex flex-col items-center gap-3">
        <span className="block h-16 w-16 overflow-hidden rounded-2xl shadow-lg">
          <svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <radialGradient id="hbg" cx="32%" cy="28%" r="85%">
                <stop offset="0%" stopColor="#17a892" />
                <stop offset="55%" stopColor="#0f7a6c" />
                <stop offset="100%" stopColor="#0a5a4f" />
              </radialGradient>
            </defs>
            <rect width="512" height="512" fill="url(#hbg)" />
            <g
              transform="translate(256,264)"
              fill="none"
              stroke="#f5fbf9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="38" cy="-26" r="58" strokeWidth="42" />
              <path
                d="M 10 22 C -20 76, -78 104, -112 92 C -136 84, -146 62, -134 42"
                strokeWidth="42"
                fill="none"
              />
            </g>
          </svg>
        </span>
        <h1 className="text-4xl font-bold" style={{ color: "#0F7A6C" }}>
          مَوْعِد
        </h1>
        <p className="text-neutral-600">اختر كيف تريد استخدام موعد</p>
      </div>

      <div className="grid w-full max-w-2xl grid-cols-1 gap-5 text-right sm:grid-cols-2">
        <Link
          href="/subscribe"
          className="flex flex-col gap-2 rounded-2xl border p-7 shadow-sm transition hover:-translate-y-0.5"
          style={{ borderColor: "#d3ece9", background: "white" }}
        >
          <h2 className="text-lg font-bold" style={{ color: "#0F7A6C" }}>
            عيادة أو مركز تجميل
          </h2>
          <p className="text-sm leading-7 text-neutral-500">
            سجّل عيادتك أو مركز التجميل لإدارة الحجوزات والاستقبال وشاشة صالة الانتظار.
          </p>
        </Link>

        <Link
          href="/find"
          className="flex flex-col gap-2 rounded-2xl border p-7 shadow-sm transition hover:-translate-y-0.5"
          style={{ borderColor: "#d3ece9", background: "white" }}
        >
          <h2 className="text-lg font-bold" style={{ color: "#0F7A6C" }}>
            مراجع
          </h2>
          <p className="text-sm leading-7 text-neutral-500">
            ابحث عن عيادتك واطلب موعدك مباشرة — بدون تسجيل حساب.
          </p>
        </Link>
      </div>
    </main>
  );
}
