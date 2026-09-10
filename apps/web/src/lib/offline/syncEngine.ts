// Background sync: flushes the local write queue to the server whenever a
// connection is available, and is safe to call repeatedly (idempotent
// no-op while offline, already-flushing, or nothing queued).
"use client";

import { v4 as uuid } from "uuid";
import type { SyncEntity, SyncOperation, SyncOpType } from "@mawid/shared";
import { getDb } from "./db";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

function tableNameFor(entity: SyncEntity) {
  return entity === "patient" ? "patients" : entity === "appointment" ? "appointments" : "visits";
}

/**
 * Writes a new record to the local table immediately (instant UI feedback,
 * online or offline) and queues it for the server. Call this instead of
 * ever calling fetch() directly from a component.
 */
export async function queueCreate<T extends { id: string }>(entity: SyncEntity, record: T) {
  const db = getDb();
  await db.table(tableNameFor(entity)).put(record);
  await enqueue(entity, "create", record.id, record as unknown as Record<string, unknown>);
  void flushQueue();
}

/** Local-first status/field update (e.g. booked -> arrived -> in_progress). */
export async function queueUpdate(entity: SyncEntity, localId: string, patch: Record<string, unknown>) {
  const db = getDb();
  await db.table(tableNameFor(entity)).update(localId, patch);
  await enqueue(entity, "update", localId, { ...patch, appointmentId: localId });
  void flushQueue();
}

async function enqueue(
  entity: SyncEntity,
  opType: SyncOpType,
  entityLocalId: string,
  payload: Record<string, unknown>
) {
  const db = getDb();
  const op: SyncOperation = {
    opId: uuid(),
    entity,
    opType,
    entityLocalId,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  await db.syncQueue.put(op);
}

let flushing = false;

/**
 * Pushes every queued operation to /api/sync/push, oldest first, then
 * remaps any client-generated id to the real server id in local storage.
 * A rejected operation (e.g. the slot was taken by another device before
 * this one reconnected) is surfaced via the return value so the UI can
 * tell the receptionist to rebook, rather than being retried forever.
 */
export async function flushQueue(): Promise<{ pushed: number; rejected: string[] }> {
  if (flushing || typeof navigator === "undefined" || !navigator.onLine) {
    return { pushed: 0, rejected: [] };
  }
  flushing = true;
  try {
    const db = getDb();
    const pending = await db.syncQueue.orderBy("createdAt").toArray();
    if (pending.length === 0) return { pushed: 0, rejected: [] };

    const res = await fetch(`${API_BASE}/api/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operations: pending }),
    });
    if (!res.ok) throw new Error(`sync push failed with HTTP ${res.status}`);

    const { results } = (await res.json()) as {
      results: { opId: string; status: "applied" | "duplicate" | "rejected"; serverId?: string; reason?: string }[];
    };

    let pushed = 0;
    const rejected: string[] = [];

    for (const r of results) {
      const op = pending.find((p) => p.opId === r.opId);
      if (!op) continue;

      if (r.status === "rejected") {
        await db.syncQueue.delete(op.opId);
        rejected.push(r.reason ?? `${op.entity} operation rejected`);
        continue;
      }

      if (r.serverId && r.serverId !== op.entityLocalId) {
        await remapLocalRecordId(op.entity, op.entityLocalId, r.serverId);
      }
      await db.syncQueue.delete(op.opId);
      pushed++;
    }

    return { pushed, rejected };
  } finally {
    flushing = false;
  }
}

async function remapLocalRecordId(entity: SyncEntity, localId: string, serverId: string) {
  const db = getDb();
  const table = db.table(tableNameFor(entity));
  const record = await table.get(localId);
  if (!record) return;
  await db.transaction("rw", table, async () => {
    await table.delete(localId);
    await table.put({ ...record, id: serverId, localId });
  });
}

/**
 * Call once on app start. Flushes immediately, then re-flushes on every
 * "online" transition and on a 20s heartbeat - the heartbeat covers clinics
 * where the browser's online/offline events fire unreliably on flaky
 * (rather than fully absent) connections.
 */
export function initBackgroundSync() {
  if (typeof window === "undefined") return () => {};

  const onOnline = () => void flushQueue();
  window.addEventListener("online", onOnline);
  const heartbeat = setInterval(() => void flushQueue(), 20_000);
  void flushQueue();

  return () => {
    window.removeEventListener("online", onOnline);
    clearInterval(heartbeat);
  };
}

export async function pendingSyncCount(): Promise<number> {
  if (typeof window === "undefined") return 0;
  return getDb().syncQueue.count();
}
