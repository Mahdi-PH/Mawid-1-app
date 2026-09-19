"use client";

// The one hook every screen that needs to know "is this slot still in the
// future?" uses to get a live-updating, reliable `now` — never a bare
// `useState(() => new Date())` reinvented per screen. Deliberately does
// NOT tick every second (no screen here needs second-level precision, and
// polling that often for no reason is exactly the battery/network cost
// this project's own build instructions ruled out): it recomputes on
// mount, once per wall-clock MINUTE boundary after that (aligned to the
// real minute, not a fixed 60000ms from whenever the component happened
// to mount), and again immediately whenever the tab/app becomes visible
// after being backgrounded — the three moments a slot can actually cross
// from "bookable" to "expired" for a reason other than someone booking it.
import { useEffect, useState } from "react";
import { ensureSynced, now as reliableNow, resync } from "./timeService";

export function useReliableNow(): number {
  const [nowMs, setNowMs] = useState<number>(() => reliableNow());

  useEffect(() => {
    let cancelled = false;
    let minuteTimer: ReturnType<typeof setTimeout> | undefined;

    function scheduleNextMinuteTick() {
      const msIntoMinute = Date.now() % 60000;
      const delay = 60000 - msIntoMinute;
      minuteTimer = setTimeout(() => {
        if (cancelled) return;
        setNowMs(reliableNow());
        scheduleNextMinuteTick();
      }, delay);
    }

    ensureSynced().then(() => {
      if (!cancelled) setNowMs(reliableNow());
    });
    scheduleNextMinuteTick();

    function handleVisibility() {
      if (document.visibilityState !== "visible") return;
      resync().then(() => {
        if (!cancelled) setNowMs(reliableNow());
      });
    }
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);

    return () => {
      cancelled = true;
      if (minuteTimer) clearTimeout(minuteTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    };
  }, []);

  return nowMs;
}
