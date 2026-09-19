import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../middleware/errorHandler";
import { findOrCreatePatientByPhone, searchPatientsByPhone } from "./patients.service";

export const patientsRouter = Router();

// GET /api/patients/search?clinicId=..&phone=05
patientsRouter.get(
  "/search",
  asyncRoute(async (req, res) => {
    const clinicId = String(req.query.clinicId ?? "");
    const phone = String(req.query.phone ?? "");
    if (!clinicId || phone.length < 2) return res.json([]);
    res.json(await searchPatientsByPhone(clinicId, phone));
  })
);

const upsertSchema = z.object({
  clinicId: z.string().uuid(),
  fullName: z.string().min(2),
  phone: z.string().min(6),
  patientCode: z.string().optional(),
  notes: z.string().optional(),
  localId: z.string().optional(),
});

// POST /api/patients — find-or-create by phone, used by the quick-book modal.
patientsRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const input = upsertSchema.parse(req.body);
    const patient = await findOrCreatePatientByPhone(input);
    res.status(201).json(patient);
  })
);
