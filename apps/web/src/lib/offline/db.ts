// Local-first storage: every screen reads and writes this IndexedDB
// database first, so the app is fully usable with zero network - patients
// and bookings created offline get a client-generated UUID as their `id`
// immediately and behave exactly like server records until they sync
// (see syncEngine.ts), when their id is remapped to the real server id.
import Dexie, { type Table } from "dexie";
import type { Appointment, Doctor, Patient, SyncOperation, Visit } from "@mawid/shared";

export class MawidDB extends Dexie {
  patients!: Table<Patient, string>;
  appointments!: Table<Appointment, string>;
  visits!: Table<Visit, string>;
  /** Read-only cache of doctors + schedules, refreshed whenever online, so the
   *  timeline grid can still render (with cached availability) while offline. */
  doctors!: Table<Doctor, string>;
  /** FIFO queue of writes waiting to reach the server. */
  syncQueue!: Table<SyncOperation, string>;

  constructor() {
    super("mawid-db");
    this.version(1).stores({
      patients: "id, phone, localId",
      appointments: "id, doctorId, date, status, localId",
      visits: "id, appointmentId, patientId, localId",
      doctors: "id, clinicId",
      syncQueue: "opId, entity, createdAt",
    });
  }
}

let instance: MawidDB | null = null;

/** Lazy singleton - Dexie/IndexedDB doesn't exist during Next.js SSR. */
export function getDb(): MawidDB {
  if (typeof window === "undefined") {
    throw new Error("getDb() must only be called in the browser.");
  }
  if (!instance) instance = new MawidDB();
  return instance;
}
