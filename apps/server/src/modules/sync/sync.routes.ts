import { Router } from "express";
import { z } from "zod";
import { AppointmentStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { asyncRoute } from "../../middleware/errorHandler";
import { createPatient } from "../patients/patients.service";
import { bookAppointment, updateAppointmentStatus, SlotTakenError } from "../appointments/appointments.service";
import { SlotNotAvailableError } from "@mawid/shared";

export const syncRouter = Router();

const operationSchema = z.object({
  opId: z.string().min(1),
  entity: z.enum(["patient", "appointment", "visit"]),
  opType: z.enum(["create", "update"]),
  entityLocalId: z.string().min(1),
  payload: z.record(z.unknown()),
  createdAt: z.string(),
  attempts: z.number().optional().default(0),
});

const pushSchema = z.object({
  operations: z.array(operationSchema).max(200),
});

type Entity = "patient" | "appointment" | "visit";

/** Any "...Id" field pointing at a record created earlier in this same batch gets swapped for its real server id. */
function remapLocalIds(payload: Record<string, unknown>, map: Map<string, string>) {
  const out: Record<string, unknown> = { ...payload };
  for (const key of Object.keys(out)) {
    const val = out[key];
    if (key.endsWith("Id") && typeof val === "string" && map.has(val)) {
      out[key] = map.get(val);
    }
  }
  return out;
}

/** Resolves a client localId to a server id, whether it synced earlier in this batch or in a previous one. */
async function resolveServerId(entity: Entity, localId: string, batchMap: Map<string, string>) {
  if (batchMap.has(localId)) return batchMap.get(localId)!;
  const table = entity === "patient" ? prisma.patient : entity === "appointment" ? prisma.appointment : prisma.visit;
  const found = await (table as any).findFirst({ where: { localId } });
  return found?.id ?? localId; // fall back: caller may already be passing a real server id
}

/**
 * Offline sync push. The reception device queues writes locally while
 * offline (see apps/web/src/lib/offline/syncEngine.ts) and flushes them here
 * once connectivity returns. Every operation carries a client-generated
 * opId, recorded in `synced_operations` after it's applied, so a retried
 * push (a flaky connection cutting the response before the client saw "OK")
 * replays as a safe no-op instead of creating duplicate patients/bookings.
 */
syncRouter.post(
  "/push",
  asyncRoute(async (req, res) => {
    const { operations } = pushSchema.parse(req.body);
    const batchMap = new Map<string, string>(); // entityLocalId -> serverId, scoped to this request
    const results: { opId: string; status: string; serverId?: string; reason?: string }[] = [];

    for (const op of operations) {
      const already = await prisma.syncedOperation.findUnique({ where: { opId: op.opId } });
      if (already) {
        batchMap.set(op.entityLocalId, already.entityId);
        results.push({ opId: op.opId, status: "duplicate", serverId: already.entityId });
        continue;
      }

      try {
        const payload = remapLocalIds(op.payload, batchMap);
        const serverId = await applyOperation(op.entity, op.opType, op.entityLocalId, payload, batchMap);

        await prisma.syncedOperation.create({
          data: { opId: op.opId, entity: op.entity, entityId: serverId },
        });
        batchMap.set(op.entityLocalId, serverId);
        results.push({ opId: op.opId, status: "applied", serverId });
      } catch (err) {
        if (err instanceof SlotTakenError || err instanceof SlotNotAvailableError) {
          // The client must surface this to the receptionist so they pick a
          // different slot; it is NOT retried automatically.
          results.push({ opId: op.opId, status: "rejected", reason: err.message });
        } else {
          throw err;
        }
      }
    }

    res.json({ results });
  })
);

async function applyOperation(
  entity: Entity,
  opType: "create" | "update",
  entityLocalId: string,
  payload: Record<string, unknown>,
  batchMap: Map<string, string>
): Promise<string> {
  if (entity === "patient" && opType === "create") {
    const patient = await createPatient({
      clinicId: String(payload.clinicId),
      fullName: String(payload.fullName),
      phone: String(payload.phone),
      patientCode: payload.patientCode as string | undefined,
      notes: payload.notes as string | undefined,
      localId: entityLocalId,
    });
    return patient.id;
  }

  if (entity === "appointment" && opType === "create") {
    const appt = await bookAppointment({
      clinicId: String(payload.clinicId),
      doctorId: String(payload.doctorId),
      patientId: String(payload.patientId),
      date: String(payload.date),
      startTime: String(payload.startTime),
      notes: payload.notes as string | undefined,
      localId: entityLocalId,
    });
    return appt.id;
  }

  if (entity === "appointment" && opType === "update") {
    const targetId = await resolveServerId("appointment", entityLocalId, batchMap);
    const appt = await updateAppointmentStatus(targetId, payload.status as AppointmentStatus);
    return appt.id;
  }

  if (entity === "visit" && opType === "create") {
    const visit = await prisma.visit.create({
      data: {
        appointmentId: await resolveServerId("appointment", String(payload.appointmentId), batchMap),
        patientId: await resolveServerId("patient", String(payload.patientId), batchMap),
        doctorId: String(payload.doctorId),
        diagnosisNote: payload.diagnosisNote as string | undefined,
        prescriptionText: payload.prescriptionText as string | undefined,
        localId: entityLocalId,
      },
    });
    return visit.id;
  }

  throw new Error(`Unsupported sync operation: ${entity}/${opType}`);
}
