// Minimal demo data: one clinic, one doctor working Sun-Thu 09:00-17:00
// with a 13:00-14:00 lunch break, in 15-minute slots.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const clinic = await prisma.clinic.create({
    data: { name: "عيادة النور", phone: "0500000000", address: "الرياض" },
  });

  const doctor = await prisma.doctor.create({
    data: {
      clinicId: clinic.id,
      fullName: "د. أحمد الشمري",
      specialty: "طب عام",
      slotDurationMinutes: 15,
      workingHours: {
        create: [0, 1, 2, 3, 4].map((weekday) => ({
          weekday,
          startTime: "09:00",
          endTime: "17:00",
        })),
      },
      breaks: {
        create: [0, 1, 2, 3, 4].map((weekday) => ({
          weekday,
          startTime: "13:00",
          endTime: "14:00",
          label: "استراحة الغداء",
        })),
      },
    },
  });

  console.log("Seeded clinic:", clinic.id, "doctor:", doctor.id);
  console.log("Set NEXT_PUBLIC_CLINIC_ID to this clinic id in apps/web/.env.local");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
