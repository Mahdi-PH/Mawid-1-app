"use client";

// Matches the demo artifact's subscription screen (one free-plan card,
// price after month 1 explicitly marked "لم يُحدَّد بعد" — no invented
// paid tiers — then a payment-account info card shown purely as
// information for after the free month ends). There is no real payment
// gateway, invoicing, or subscription-expiry tracking behind this in
// either track — the account number is a manual bank/wallet transfer
// instruction, same as the artifact, and registerClinic() doesn't read or
// store anything from this page.
//
// This page now serves two roles (see CLAUDE.md "Signup/subscribe reorder"):
// the home page's clinic/center card routes straight to /signup, and
// SignupClient.tsx's registerClinic() success handler routes *here*
// afterward with ?registered=1 — so a fresh visitor (no query params) gets
// the original marketing framing with a "ابدأ مجاناً" continue-to-signup
// button, while someone who just finished signing up gets the same plan
// info plus a pending-approval confirmation and a button back to the home
// screen (see BackButton usage below), not a redundant "start free" CTA
// for an account that already exists.
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import BackButton from "../../components/BackButton";

const PAYMENT_ACCOUNT = "910459764999";

export default function SubscribePage() {
  return (
    <Suspense fallback={<p className="p-6 text-gray-500">جارٍ التحميل…</p>}>
      <SubscribeContent />
    </Suspense>
  );
}

function SubscribeContent() {
  const params = useSearchParams();
  const [copied, setCopied] = useState(false);
  const justRegistered = params.get("registered") === "1";
  const clinicName = params.get("name");

  return (
    <main dir="rtl" className="mx-auto max-w-md p-6" style={{ background: "#F5FBF9", minHeight: "100vh" }}>
      <BackButton fallbackHref="/" />

      <h1 className="mb-1 mt-3 text-xl font-bold" style={{ color: "#0F7A6C" }}>
        اشتراك مركزك
      </h1>
      <p className="mb-6 text-sm text-gray-500">خطة واحدة، بسيطة وواضحة.</p>

      {justRegistered && (
        <div className="mb-4 rounded-2xl border border-green-200 bg-green-50 p-5">
          <div className="mb-1 font-bold text-green-800">تم إرسال طلبك</div>
          <p className="text-sm leading-7 text-green-800">
            طلب تسجيل &quot;{clinicName || "مركزك"}&quot; قيد المراجعة من قبل الإدارة، وسيتم تفعيل حسابك بعد
            الموافقة على الإجازة المرفوعة. هذه هي تفاصيل خطة الاشتراك في انتظار التفعيل:
          </p>
        </div>
      )}

      <div className="mb-4 rounded-2xl border-2 bg-white p-6" style={{ borderColor: "#0F7A6C" }}>
        <div className="mb-2 text-sm font-bold" style={{ color: "#0F7A6C" }}>
          أول شهر مجاناً
        </div>
        <p className="text-sm leading-7 text-gray-600">
          إدارة كاملة للحجوزات، الاستقبال، وشاشة صالة الانتظار — بلا أي رسوم خلال الشهر الأول.
        </p>
        <p className="mt-3 text-xs text-gray-400">
          السعر بعد الشهر الأول <span className="font-bold">لم يُحدَّد بعد</span> وسيُعلن لاحقاً — قد تُضاف خطط
          مدفوعة بمزايا أوسع. الأسعار هنا تجريبية وقابلة للتعديل قبل الإطلاق الرسمي.
        </p>
      </div>

      <div className="mb-6 rounded-2xl border bg-white p-6">
        <div className="mb-2 font-bold">الدفع بعد انتهاء الشهر المجاني</div>
        <p className="mb-3 text-sm text-gray-500">
          عند انتهاء الفترة المجانية، تحويل قيمة الاشتراك (سيُعلن عنها لاحقاً) يكون إلى الحساب التالي:
        </p>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={PAYMENT_ACCOUNT}
            dir="ltr"
            className="w-full rounded-lg border bg-gray-50 px-3 py-2 font-mono text-sm"
          />
          <button
            onClick={() => {
              navigator.clipboard?.writeText(PAYMENT_ACCOUNT);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="shrink-0 rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
          >
            {copied ? "تم النسخ" : "نسخ"}
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          سيصلك تذكير قبل انتهاء الشهر المجاني بخيارات الدفع النهائية. طريقة الدفع هنا تجريبية وقابلة للتغيير
          لاحقاً.
        </p>
      </div>

      {justRegistered ? (
        <Link
          href="/"
          className="block w-full rounded-lg bg-brand-500 py-3 text-center font-bold text-white hover:bg-brand-600"
        >
          العودة إلى الواجهة الرئيسية
        </Link>
      ) : (
        <Link
          href="/signup"
          className="block w-full rounded-lg bg-brand-500 py-3 text-center font-bold text-white hover:bg-brand-600"
        >
          ابدأ مجاناً
        </Link>
      )}
    </main>
  );
}
