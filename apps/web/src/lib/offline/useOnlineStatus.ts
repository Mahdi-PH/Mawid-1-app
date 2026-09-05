"use client";

import { useEffect, useState } from "react";
import { initBackgroundSync, pendingSyncCount } from "./syncEngine";

/**
 * Drives the connectivity badge in the dashboard header: online/offline
 * state plus how many local writes are still waiting to reach the server.
 * Mounting this once (in the dashboard layout) is also what starts the
 * background sync loop for the whole app.
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const stop = initBackgroundSync();

    const update = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    const poll = setInterval(() => {
      pendingSyncCount().then(setPending).catch(() => {});
    }, 3000);

    return () => {
      stop();
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      clearInterval(poll);
    };
  }, []);

  return { isOnline, pending };
}
