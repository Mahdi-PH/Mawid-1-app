import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "موعد | Mawid",
  description: "نظام إدارة حجوزات العيادات الطبية الصغيرة",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
