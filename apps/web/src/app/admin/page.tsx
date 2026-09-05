"use client";

// Forced dynamic (no static prerendering) via admin/layout.tsx.
//
// Pure "نافذة إحصاء عام" now — every sub-section this page used to render
// directly (طلبات التسجيل المعلَّقة، الاشتراكات، الحسابات المرفوضة،
// المستخدمون المسجَّلون) moved into components/AdminSettingsDrawer.tsx,
// opened from the gear icon in admin/layout.tsx's header. This page is
// left with only the four general KPI tiles the user asked for: total
// users, total bookings, active (subscription-live) centers, and
// currently in-flight bookings.
import { useEffect, useState } from "react";
import {
  adminGetActiveBookingsCount,
  adminGetStats,
  adminListApprovedClinics,
  isSubscriptionActive,
} from "../../lib/firebase/firestore";
import { onAdminDataChanged } from "../../lib/adminRefreshBus";

interface Stats {
  userCount: number;
  appointmentCount: number;
  activeCenterCount: number;
  activeBookingCount: number;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [s, activeBookingCount, approved] = await Promise.all([
      adminGetStats(),
      adminGetActiveBookingsCount(),
      adminListApprovedClinics(),
    ]);
    setStats({
      ...s,
      activeBookingCount,
      // Every clinic admin ever approved, but only those whose 30-day
      // clock hasn't lapsed count as "مفعَّل" — status and subscription
      // are separate axes throughout this app (see isSubscriptionActive's
      // own doc comment), so this can't just be approved.length.
      activeCenterCount: approved.filter(isSubscriptionActive).length,
    });
  }

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // AdminSettingsDrawer is a sibling under the same layout, not a
    // parent/child of this page, so an approve/reject/renew/delete made
    // there wouldn't otherwise be reflected here until this page next
    // remounts — this keeps the KPI tiles live instead.
    return onAdminDataChanged(() => {
      reload().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }, []);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!stats) return <p className="text-gray-500">جارٍ التحميل…</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-gray-700">نظرة عامة</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard icon="👥" label="إجمالي المستخدمين" value={stats.userCount} color="#0F7A6C" />
        <StatCard icon="📅" label="إجمالي الحجوزات" value={stats.appointmentCount} color="#2563EB" />
        <StatCard icon="🏥" label="المراكز المفعَّلة" value={stats.activeCenterCount} color="#16A34A" />
        <StatCard icon="⏳" label="الحجوزات النشطة" value={stats.activeBookingCount} color="#D97706" />
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: string; label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div
        aria-hidden
        className="mb-3 flex h-10 w-10 items-center justify-center rounded-full text-lg"
        style={{ backgroundColor: `${color}1a`, color }}
      >
        {icon}
      </div>
      <div className="text-2xl font-extrabold" style={{ color }}>
        {value}
      </div>
      <div className="text-sm text-gray-500">{label}</div>
    </div>
  );
}
