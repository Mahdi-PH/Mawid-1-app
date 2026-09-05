import type { Metadata, Viewport } from "next";
import "../styles/globals.css";
import { RegisterServiceWorker } from "../components/RegisterServiceWorker";

export const metadata: Metadata = {
  title: "موعد | Mawid",
  description: "نظام إدارة حجوزات العيادات الطبية الصغيرة",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "موعد",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f7a6c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
