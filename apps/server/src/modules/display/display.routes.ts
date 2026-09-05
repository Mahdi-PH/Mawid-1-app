import { Router } from "express";
import { AppointmentStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { asyncRoute } from "../../middleware/errorHandler";

export const displayRouter = Router();

/**
 * GET /api/display/now?clinicId=..&date=2026-08-30
 *
 * Feeds the waiting-room TV page. Deliberately returns only queueNumber +
 * doctor name — never the patient's full name or phone — so the screen
 * facing a room full of strangers doesn't leak anyone's identity.
 * The web client polls this every few seconds (see apps/web waiting room
 * page); plain polling was chosen over WebSocket/SSE because clinic
 * connections here are often flaky and a dropped poll just retries next tick.
 */
displayRouter.get(
  "/now",
  asyncRoute(async (req, res) => {
    const clinicId = String(req.query.clinicId ?? "");
    const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
    if (!clinicId) return res.status(400).json({ error: "clinicId is required" });

    const [nowServing, waiting] = await Promise.all([
      prisma.appointment.findMany({
        where: { clinicId, date, status: AppointmentStatus.in_progress },
        include: { doctor: { select: { fullName: true } } },
        orderBy: { startTime: "asc" },
      }),
      prisma.appointment.findMany({
        where: { clinicId, date, status: AppointmentStatus.arrived },
        include: { doctor: { select: { fullName: true } } },
        orderBy: { startTime: "asc" },
      }),
    ]);

    const strip = (a: (typeof nowServing)[number]) => ({
      appointmentId: a.id,
      queueNumber: a.queueNumber,
      doctorName: a.doctor.fullName,
      startTime: a.startTime,
    });

    res.json({
      nowServing: nowServing.map(strip),
      waiting: waiting.map(strip),
      generatedAt: new Date().toISOString(),
    });
  })
);
