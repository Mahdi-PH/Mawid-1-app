"use client";

// Matches the demo artifact's subscription screen exactly: one free-plan
// card (price after month 1 explicitly marked "لم يُحدَّد بعد" — no
// invented paid tiers), then a payment-account info card shown purely as
// information for after the free month ends. There is no real payment
// gateway, invoicing, or subscription-expiry tracking behind this in
// either track — the account number is a manual bank/wallet transfer
// instruction, same as the artifact, and registerClinic() doesn't read
// or store anything from this page. "ابدأ مجاناً" just continues to the
// real signup form.
import Link from "next/link";
import { useState } from "react";

const PAYMENT_ACCOUNT = "910459764999";

export default function SubscribePage() {
  const [copied, setCopied] = useState(false);

  return (
    <main dir="rtl" className="mx-auto max-w-md p-6" style={{ background: "#F5FBF9", minHeight: "100vh" }}>
      <Link href="/" className="text-sm text-brand-600 hover:underline">
        ‹ رجوع
      </Link>

      <h1 className="mb-1 mt-3 text-xl font-bold" style={{ color: "#0F7A6C" }}>
        اشتراك عيادتك أو مركز التجميل
      </h1>
      <p className="mb-6 text-sm text-gray-500">خطة واحدة، بسيطة وواضحة.</p>

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

      <Link
        href="/signup"
        className="block w-full rounded-lg bg-brand-500 py-3 text-center font-bold text-white hover:bg-brand-600"
      >
        ابدأ مجاناً
      </Link>
    </main>
  );
}
