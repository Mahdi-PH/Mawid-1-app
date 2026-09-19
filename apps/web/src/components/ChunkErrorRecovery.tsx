"use client";

import { useEffect } from "react";

const RELOAD_FLAG_KEY = "mawid_chunk_reload_attempted";

function looksLikeChunkLoadFailure(message: string | undefined, name: string | undefined): boolean {
  if (!message && !name) return false;
  const text = `${name ?? ""} ${message ?? ""}`;
  return (
    /ChunkLoadError/i.test(text) ||
    /loading chunk [\w.-]+ failed/i.test(text) ||
    /failed to fetch dynamically imported module/i.test(text) ||
    /importing a module script failed/i.test(text)
  );
}

/** Root-cause guard for the other half of "UI disappears on refresh": a
 *  chunk-load/dynamic-import failure. This project ships a new,
 *  content-hashed JS build on every deploy (see CLAUDE.md's own deploy
 *  history) while public/sw.js caches static assets cache-first — so a
 *  client that had the app open since before a deploy, or one whose
 *  service worker served an already-cached reference to a chunk filename
 *  from an earlier visit, can end up asking the browser to fetch a chunk
 *  that no longer exists on the server. That request 404s and throws a
 *  ChunkLoadError/"failed to fetch dynamically imported module" error
 *  OUTSIDE React's render phase (a script-loading failure, not a render
 *  exception) — app/error.tsx's boundary can't reach it, since it only
 *  catches exceptions React itself throws while rendering. With nothing
 *  left able to render, the page goes blank: exactly the reported "UI
 *  disappears entirely when trying to refresh/refetch" symptom.
 *
 *  The only real fix for a genuinely stale bundle is a real reload (no
 *  amount of in-memory retry can serve a file that isn't there) — guarded
 *  by a one-shot sessionStorage flag so a single unrelated JS error can
 *  never turn into a reload loop; a second, different failure within the
 *  same tab session is left alone rather than reloaded again. */
export function ChunkErrorRecovery() {
  useEffect(() => {
    function tryRecover(message: string | undefined, name: string | undefined) {
      if (!looksLikeChunkLoadFailure(message, name)) return;
      let alreadyTried = false;
      try {
        alreadyTried = sessionStorage.getItem(RELOAD_FLAG_KEY) === "1";
      } catch {
        // sessionStorage inaccessible (private mode, blocked storage) —
        // fail open to a single reload attempt rather than staying blank.
      }
      if (alreadyTried) return;
      try {
        sessionStorage.setItem(RELOAD_FLAG_KEY, "1");
      } catch {
        // best-effort guard only; proceed with the reload regardless.
      }
      window.location.reload();
    }

    function onError(event: ErrorEvent) {
      tryRecover(event.message, event.error?.name);
    }
    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason as { message?: string; name?: string } | undefined;
      tryRecover(reason?.message ?? (typeof reason === "string" ? reason : undefined), reason?.name);
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
