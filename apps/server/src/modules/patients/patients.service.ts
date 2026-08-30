import { prisma } from "../../db/prisma";

export interface CreatePatientInput {
  clinicId: string;
  fullName: string;
  phone: string;
  patientCode?: string;
  notes?: string;
  localId?: string;
}

/** Reception almost always searches by phone first to avoid duplicate patient records. */
export async function searchPatientsByPhone(clinicId: string, phoneQuery: string) {
  return prisma.patient.findMany({
    where: { clinicId, phone: { contains: phoneQuery } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
}

export async function createPatient(input: CreatePatientInput) {
  return prisma.patient.create({ data: input });
}

/**
 * Powers the "new patient in one step" quick-booking flow: if a patient with
 * this exact phone already exists for the clinic, reuse them instead of
 * creating a duplicate file.
 */
export async function findOrCreatePatientByPhone(input: CreatePatientInput) {
  const existing = await prisma.patient.findFirst({
    where: { clinicId: input.clinicId, phone: input.phone },
  });
  if (existing) return existing;
  return createPatient(input);
}
