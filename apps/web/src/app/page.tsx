import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-3xl font-bold text-brand-700">موعد | Mawid</h1>
      <p className="text-neutral-600">نظام إدارة حجوزات العيادات الطبية الصغيرة</p>
      <div className="flex gap-4">
        <Link href="/dashboard" className="rounded-lg bg-brand-500 px-5 py-3 text-white hover:bg-brand-600">
          لوحة الاستقبال
        </Link>
        <Link href="/display" className="rounded-lg border border-brand-500 px-5 py-3 text-brand-600 hover:bg-brand-50">
          شاشة صالة الانتظار
        </Link>
      </div>
    </main>
  );
}
