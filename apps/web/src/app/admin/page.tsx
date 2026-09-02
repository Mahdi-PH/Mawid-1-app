"use client";

// Forced dynamic (no static prerendering) via admin/layout.tsx.

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminGetStats, adminListUsers } from "../../lib/firebase/firestore";
import type { UserDoc } from "../../lib/firebase/types";

function formatDate(ts: UserDoc["createdAt"]): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("ar", { year: "numeric", month: "short", day: "numeric" });
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<{ userCount: number; appointmentCount: number } | null>(null);
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, u] = await Promise.all([adminGetStats(), adminListUsers()]);
        setStats(s);
        setUsers(u);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p className="text-gray-500">جارٍ التحميل…</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="إجمالي المستخدمين" value={stats?.userCount ?? 0} />
        <StatCard label="إجمالي الحجوزات" value={stats?.appointmentCount ?? 0} />
      </div>

      <div className="rounded-xl border bg-white">
        <div className="border-b px-4 py-3 font-bold">المستخدمون المسجَّلون</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-right text-gray-500">
              <th className="px-4 py-2 font-medium">الاسم</th>
              <th className="px-4 py-2 font-medium">البريد الإلكتروني</th>
              <th className="px-4 py-2 font-medium">الدور</th>
              <th className="px-4 py-2 font-medium">تاريخ التسجيل</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.uid} className="border-b last:border-0">
                <td className="px-4 py-2">{u.displayName}</td>
                <td className="px-4 py-2 text-gray-600" dir="ltr">
                  {u.email}
                </td>
                <td className="px-4 py-2">{u.role === "admin" ? "مدير" : "عيادة"}</td>
                <td className="px-4 py-2">{formatDate(u.createdAt)}</td>
                <td className="px-4 py-2">
                  <Link href={`/admin/users/${u.uid}`} className="text-brand-600 hover:underline">
                    التفاصيل ›
                  </Link>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  لا يوجد مستخدمون بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-2xl font-bold text-brand-700">{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
    </div>
  );
}
