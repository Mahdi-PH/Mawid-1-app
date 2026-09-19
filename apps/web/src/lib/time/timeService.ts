"use client";

// The one place this app decides "what time is it, really?" for booking
// purposes — every screen that needs "now" calls TimeService.now() instead
// of `new Date()`/`Date.now()` directly, so the whole app can't drift into
// three different notions of "current time" across three different files.
//
// IMPORTANT — what this actually is and isn't: this is a best-effort UX
// layer only, never the security boundary. A device's own clock can be
// changed by its owner at will, so no purely client-side estimate of "now"
// — however it's computed — can be trusted to gate whether a booking is
// actually allowed. The real, unspoofable authority is Firestore's own
// `request.time` inside firestore.rules (see bookSlot()'s own comment and
// firestore.rules' appointments create rule) — that value is stamped by
// Firestore's servers at the moment they evaluate the write, completely
// outside any client's control. TimeService exists purely so the UI can
// *predict* that server-side outcome closely enough to hide/disable a
// slot before the user wastes a tap on it, and to keep every screen's
// prediction consistent with every other screen's.
//
// How the estimate is produced, without polling every second: write one
// small scratch document with Firestore's serverTimestamp() sentinel, then
// read it back with getDocFromServer() (a real round-trip, not the local
// cache) — the difference between the resolved server timestamp and this
// device's own clock at that moment is the "offset". Cache that offset in
// memory; from then on, now() is just `Date.now() + offset`, an in-process
// arithmetic op with zero network cost. Re-synced only when it matters —
// once per session, and again whenever the app becomes visible after being
// backgrounded/closed for a while — never on a fixed short interval.
import { doc, getDocFromServer, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase/config";

let offsetMillis = 0;
let lastSyncedAt = 0;
let syncInFlight: Promise<void> | null = null;

const RESYNC_AFTER_MS = 5 * 60 * 1000; // re-check after 5 minutes of being backgrounded/idle

/** Best current estimate of the real, absolute time, in epoch ms. Falls
 *  back to the device's own clock (offset 0) if a sync has never
 *  succeeded — e.g. fully offline on first load — which is exactly the
 *  device-clock behavior this whole service exists to improve on, not a
 *  new failure mode: the UI is no worse off than it always was without
 *  TimeService, and the real firestore.rules check downstream is
 *  unaffected either way. */
export function now(): number {
  return Date.now() + offsetMillis;
}

async function sync(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return; // no session yet to write the probe under — try again once one exists
  const ref = doc(db, "serverTimeProbe", uid);
  const sentAt = Date.now();
  await setDoc(ref, { t: serverTimestamp() });
  const snap = await getDocFromServer(ref);
  const receivedAt = Date.now();
  const serverMillis = (snap.data()?.t as { toMillis?: () => number } | undefined)?.toMillis?.();
  if (typeof serverMillis !== "number") return;
  // The write+read round-trip has some latency; the server timestamp was
  // actually stamped somewhere inside that window, so the request's own
  // midpoint is a closer estimate of "device clock at the moment the
  // server saw it" than either endpoint alone.
  const midpoint = sentAt + (receivedAt - sentAt) / 2;
  offsetMillis = serverMillis - midpoint;
  lastSyncedAt = receivedAt;
}

/** Call on mount of any screen that needs a reliable "now" (the booking
 *  grid, in practice). Idempotent and de-duplicated: several screens/
 *  effects can call this around the same time without firing multiple
 *  redundant probe writes. Failures (offline, no session yet) are
 *  swallowed — see now()'s own fallback. */
export function ensureSynced(): Promise<void> {
  if (Date.now() - lastSyncedAt < RESYNC_AFTER_MS) return Promise.resolve();
  if (!syncInFlight) {
    syncInFlight = sync()
      .catch(() => {})
      .finally(() => {
        syncInFlight = null;
      });
  }
  return syncInFlight;
}

/** Force a fresh sync regardless of how recently the last one succeeded —
 *  used on app resume (see useReliableNow.ts), since a device clock is
 *  most likely to have been changed, or to have drifted from a long sleep,
 *  exactly across a background/foreground gap. */
export function resync(): Promise<void> {
  lastSyncedAt = 0;
  return ensureSynced();
}
