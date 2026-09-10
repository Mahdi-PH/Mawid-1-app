"use client";

import { useEffect, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";
const CLINIC_ID = process.env.NEXT_PUBLIC_CLINIC_ID ?? "demo-clinic";
const POLL_MS = 4000;

interface DisplayTicket {
  appointmentId: string;
  queueNumber: number;
  doctorName: string;
  startTime: string;
}

interface DisplayState {
  nowServing: DisplayTicket[];
  waiting: DisplayTicket[];
  generatedAt: string;
}

/** Short two-tone chime via Web Audio API - no audio file to ship or fail to load. */
function playChime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const beep = (freq: number, startAt: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.15, ctx.currentTime + startAt);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + 0.4);
      osc.start(ctx.currentTime + startAt);
      osc.stop(ctx.currentTime + startAt + 0.4);
    };
    beep(880, 0);
    beep(1175, 0.25);
  } catch {
    // Autoplay can be blocked until the page has a user gesture - the
    // visual pulse below still announces the call either way.
  }
}

/**
 * Waiting-room TV screen. Shows only queue numbers + doctor name - never a
 * patient's name or phone - and polls the display endpoint every few
 * seconds. Polling (not a websocket) was chosen deliberately: this screen
 * runs unattended for hours on clinic wifi, and a dropped poll just quietly
 * retries on the next tick instead of needing reconnect logic.
 */
export default function DisplayPage() {
  const [state, setState] = useState<DisplayState | null>(null);
  const lastCalledRef = useRef<Set<string>>(new Set());
  const [pulseIds, setPulseIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(
          `${API_BASE}/api/display/now?clinicId=${CLINIC_ID}&date=${new Date().toISOString().slice(0, 10)}`
        );
        if (!res.ok || cancelled) return;
        const data: DisplayState = await res.json();

        const nowIds = new Set(data.nowServing.map((t) => t.appointmentId));
        const newlyCalled = [...nowIds].filter((id) => !lastCalledRef.current.has(id));
        if (newlyCalled.length > 0 && lastCalledRef.current.size > 0) {
          playChime();
          setPulseIds(new Set(newlyCalled));
          setTimeout(() => setPulseIds(new Set()), 3000);
        }
        lastCalledRef.current = nowIds;
        setState(data);
      } catch {
        // offline/unreachable - keep showing the last known state.
      }
    }

    tick();
    const interval = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <main dir="rtl" className="min-h-screen bg-neutral-900 p-8 text-white">
      <h1 className="mb-8 text-center text-3xl font-bold text-brand-100">صالة الانتظار — الرقم الحالي</h1>

      <section className="mb-10 grid gap-6 sm:grid-cols-2">
        {(state?.nowServing ?? []).length === 0 && (
          <p className="col-span-2 text-center text-neutral-400">لا يوجد مريض عند الطبيب حاليًا</p>
        )}
        {state?.nowServing.map((t) => (
          <div
            key={t.appointmentId}
            className={`rounded-2xl border-4 p-8 text-center transition-transform ${
              pulseIds.has(t.appointmentId) ? "scale-105 border-amber-400 bg-amber-500/20" : "border-brand-500 bg-brand-500/10"
            }`}
          >
            <p className="text-sm text-neutral-300">{t.doctorName}</p>
            <p className="mt-2 text-7xl font-black tabular-nums text-white">{t.queueNumber}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-neutral-300">قائمة الانتظار</h2>
        <div className="flex flex-wrap gap-3">
          {(state?.waiting ?? []).map((t) => (
            <span key={t.appointmentId} className="rounded-full bg-neutral-800 px-4 py-2 text-xl font-bold">
              {t.queueNumber}
            </span>
          ))}
          {(state?.waiting ?? []).length === 0 && <span className="text-neutral-500">لا يوجد مرضى في الانتظار</span>}
        </div>
      </section>
    </main>
  );
}
