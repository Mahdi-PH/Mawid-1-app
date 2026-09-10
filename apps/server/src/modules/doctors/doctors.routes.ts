import { Router } from "express";
import { prisma } from "../../db/prisma";
import { asyncRoute } from "../../middleware/errorHandler";

export const doctorsRouter = Router();

// GET /api/doctors?clinicId=..
doctorsRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const clinicId = String(req.query.clinicId ?? "");
    const doctors = await prisma.doctor.findMany({
      where: { clinicId: clinicId || undefined, active: true },
      include: { workingHours: true, breaks: true },
    });
    res.json(doctors);
  })
);
