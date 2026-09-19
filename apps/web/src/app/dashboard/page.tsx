"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppointmentStatus, Doctor } from "@mawid/shared";
import { getDb } from "../../lib/offline/db";
import { useOnlineStatus } from "../../lib/offline/useOnlineStatus";
import { getDayView, refreshFromServer, setAppointmentStatus, type DaySlotView } from "../../lib/api/client";
import { Timeline } from "../../components/Timeline";
import { QuickBookModal } from "../../components/QuickBookModal";

// Reception kiosks belong to one clinic; set this once per device deployment.
const CLINIC_ID = process.env.NEXT_PUBLIC_CLINIC_ID ?? "demo-clinic";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function DashboardPage() {
  const { isOnline, pending } = useOnlineStatus();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorId, setDoctorId] = useState<string>("");
  const [date, setDate] = useState(todayISO());
  const [slots, setSlots] = useState<DaySlotView[]>([]);
  const [modalSlot, setModalSlot] = useState<string | null>(null);

  const reloadTimeline = useCallback(async () => {
    if (!doctorId) return;
    setSlots(await getDayView(doctorId, date));
  }, [doctorId, date]);

  // First mount: load whichever doctors are already cached locally (works
  // fully offline on a returning device), then try to refresh from server.
  useEffect(() => {
    (async () => {
      const db = getDb();
      const cached = await db.doctors.toArray();
      setDoctors(cached);
      if (cached[0]) setDoctorId(cached[0].id);
      await refreshFromServer(CLINIC_ID, "", date);
      const refreshed = await db.doctors.toArray();
      setDoctors(refreshed);
      setDoctorId((current) => current || refreshed[0]?.id || "");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!doctorId) return;
    refreshFromServer(CLINIC_ID, doctorId, date).finally(reloadTimeline);
  }, [doctorId, date, reloadTimeline]);

  async function handleStatusChange(appointmentId: string, status: AppointmentStatus) {
    await setAppointmentStatus(appointmentId, status);
    await reloadTimeline();
  }

  async function handleBooked() {
    setModalSlot(null);
    await reloadTimeline();
  }

  return (
    <main className="mx-auto max-w-3xl p-4 pb-10">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-brand-700">لوحة الاستقبال — موعد</h1>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            isOnline ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
          }`}
        >
          {isOnline ? "متصل بالإنترنت" : "غير متصل — العمل محليًا"}
          {pending > 0 && ` · ${pending} بانتظار المزامنة`}
        </span>
      </header>

      <div className="mb-4 flex gap-3">
        <select
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2"
        >
          {doctors.length === 0 && <option value="">لا يوجد أطباء بعد</option>}
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fullName}
              {d.specialty ? ` — ${d.specialty}` : ""}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-neutral-300 px-3 py-2"
        />
      </div>

      <Timeline slots={slots} onEmptySlotClick={setModalSlot} onStatusChange={handleStatusChange} />

      {modalSlot && doctorId && (
        <QuickBookModal
          clinicId={CLINIC_ID}
          doctorId={doctorId}
          date={date}
          startTime={modalSlot}
          onClose={() => setModalSlot(null)}
          onBooked={handleBooked}
        />
      )}
    </main>
  );
}
