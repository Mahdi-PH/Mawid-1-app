import { Router } from "express";
import { AppointmentStatus } from "@prisma/client";
import { z } from "zod";
import { asyncRoute } from "../../middleware/errorHandler";
import {
  bookAppointment,
  getDoctorDayView,
  updateAppointmentStatus,
} from "./appointments.service";

export const appointmentsRouter = Router();

const bookSchema = z.object({
  clinicId: z.string().uuid(),
  doctorId: z.string().uuid(),
  patientId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  notes: z.string().optional(),
  localId: z.string().optional(),
});

// GET /api/appointments/day?doctorId=..&date=2026-08-30
// Full timeline grid for the reception dashboard: every slot, free or taken.
appointmentsRouter.get(
  "/day",
  asyncRoute(async (req, res) => {
    const doctorId = String(req.query.doctorId ?? "");
    const date = String(req.query.date ?? "");
    if (!doctorId || !date) {
      return res.status(400).json({ error: "doctorId and date are required" });
    }
    res.json(await getDoctorDayView(doctorId, date));
  })
);

// POST /api/appointments — the "book a slot" action (<=3 clicks from the UI).
appointmentsRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const input = bookSchema.parse(req.body);
    const appointment = await bookAppointment(input);
    res.status(201).json(appointment);
  })
);

const statusSchema = z.object({
  status: z.nativeEnum(AppointmentStatus),
});

// PATCH /api/appointments/:id/status — drives the colored status pipeline.
appointmentsRouter.patch(
  "/:id/status",
  asyncRoute(async (req, res) => {
    const { status } = statusSchema.parse(req.body);
    const appointment = await updateAppointmentStatus(req.params.id, status);
    res.json(appointment);
  })
);
