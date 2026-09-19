import { Router } from "express";
import { z } from "zod";
import { AppointmentStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { asyncRoute } from "../../middleware/errorHandler";
import { updateAppointmentStatus } from "../appointments/appointments.service";

export const visitsRouter = Router();

const createVisitSchema = z.object({
  appointmentId: z.string().uuid(),
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  diagnosisNote: z.string().optional(),
  prescriptionText: z.string().optional(),
  localId: z.string().optional(),
});

// POST /api/visits — the doctor's quick note/prescription for one appointment.
// Also flips the appointment to "completed" in the same request so the
// waiting-room TV and dashboard update immediately.
visitsRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const input = createVisitSchema.parse(req.body);

    const visit = await prisma.$transaction(async (tx) => {
      const created = await tx.visit.create({ data: input });
      return created;
    });

    await updateAppointmentStatus(input.appointmentId, AppointmentStatus.completed);
    res.status(201).json(visit);
  })
);

// GET /api/visits/patient/:patientId — quick history lookup for reception/doctor.
visitsRouter.get(
  "/patient/:patientId",
  asyncRoute(async (req, res) => {
    const visits = await prisma.visit.findMany({
      where: { patientId: req.params.patientId },
      orderBy: { createdAt: "desc" },
    });
    res.json(visits);
  })
);
