"use client";

// Matches the demo artifact's subscription screen: one free-plan card,
// price after month 1 explicitly marked "لم يُحدَّد بعد" — no invented paid
// tiers. The payment-account info card used to also live here, but per the
// user's explicit ask it now shows ONLY inside /clinic's "خطة الاشتراك" tab
// after login — this screen is pre-login/pre-approval, so a clinic that
// hasn't signed in yet has nowhere to actually use that account number yet
// anyway. There is no real payment gateway, invoicing, or subscription-
// expiry tracking behind the free-plan framing on this page — that's all
// real once a clinic is signed in (see firestore.ts's subscription
// functions), just not shown here. registerClinic() doesn't read or store
// anything from this page.
//
// This page now serves two roles (see CLAUDE.md "Signup/subscribe reorder"):
// the home page's clinic/center card routes straight to /signup (which
// itself now shows this same free-plan info at the top of the login/signup
// form, per the user's later "merge with the login box" request), and
// SignupClient.tsx's registerClinic() success handler routes *here*
// afterward with ?registered=1 — so a fresh visitor (no query params) gets
// the original marketing framing with a "ابدأ مجاناً" continue-to-signup
// button, while someone who just finished signing up gets the same plan
// info plus a pending-approval confirmation and a button back to the home
// screen (see BackButton usage below), not a redundant "start free" CTA
// for an account that already exists.
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import BackButton from "../../components/BackButton";
import AppBackdrop from "../../components/AppBackdrop";

export default function SubscribePage() {
  return (
    <Suspense fallback={<p className="p-6 text-gray-500">جارٍ التحميل…</p>}>
      <SubscribeContent />
    </Suspense>
  );
}

function SubscribeContent() {
  const params = useSearchParams();
  const justRegistered = params.get("registered") === "1";
  const clinicName = params.get("name");

  return (
    <main
      dir="rtl"
      className="relative mx-auto max-w-md p-6"
      style={{ background: "#F5FBF9", minHeight: "100vh" }}
    >
      <AppBackdrop />
      <div className="relative">
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

      {justRegistered && (
        <p className="mb-6 text-sm text-gray-500">
          بعد تفعيل حسابك، ستجد كل تفاصيل اشتراكك — تاريخ البداية والنهاية وحساب الدفع — داخل تبويب
          &quot;خطة الاشتراك&quot; في لوحة عيادتك.
        </p>
      )}

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
      </div>
    </main>
  );
}
