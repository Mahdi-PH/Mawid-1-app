"use client";

import { useEffect } from "react";

/** Registers the app-shell service worker (public/sw.js) so the PWA installs
 *  on Android/iOS/Windows and cold-starts without a network connection. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("[sw] registration failed:", err);
      });
    }
  }, []);

  return null;
}
