import cron from "node-cron";
import { AppointmentStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { sendWhatsAppReminder } from "./whatsapp.service";

const REMINDER_HOURS_BEFORE = Number(process.env.REMINDER_HOURS_BEFORE ?? 3);
// Runs every 15 minutes; the scan window below is wider than that cadence so
// no appointment can slip through between two runs.
const CRON_EXPRESSION = "*/15 * * * *";
const HALF_WINDOW_MINUTES = 8;

function combineDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Finds every appointment landing REMINDER_HOURS_BEFORE hours from now
 * (within a +/- HALF_WINDOW_MINUTES tolerance) that hasn't been reminded
 * yet, and sends one WhatsApp template message per patient. This is the
 * "no-show reduction" feature: a reminder a few hours ahead of time.
 */
export async function runReminderSweep() {
  const now = new Date();
  const windowStart = new Date(now.getTime() + (REMINDER_HOURS_BEFORE * 60 - HALF_WINDOW_MINUTES) * 60_000);
  const windowEnd = new Date(now.getTime() + (REMINDER_HOURS_BEFORE * 60 + HALF_WINDOW_MINUTES) * 60_000);

  // date is stored as a plain "YYYY-MM-DD" string, so narrow by the (at most
  // two) calendar days the window can touch before filtering precisely in JS.
  const candidateDates = Array.from(new Set([toDateKey(windowStart), toDateKey(windowEnd)]));

  const appointments = await prisma.appointment.findMany({
    where: {
      date: { in: candidateDates },
      status: { in: [AppointmentStatus.booked, AppointmentStatus.arrived] },
      reminderSentAt: null,
    },
    include: { patient: true, doctor: true, clinic: true },
  });

  let sent = 0;
  for (const appt of appointments) {
    const apptDateTime = combineDateTime(appt.date, appt.startTime);
    if (apptDateTime < windowStart || apptDateTime > windowEnd) continue;

    try {
      await sendWhatsAppReminder(appt.patient.phone, {
        patientName: appt.patient.fullName,
        clinicName: appt.clinic.name,
        doctorName: appt.doctor.fullName,
        date: appt.date,
        startTime: appt.startTime,
      });
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { reminderSentAt: new Date() },
      });
      sent++;
    } catch (err) {
      // reminderSentAt stays null on purpose so the next sweep retries.
      console.error(`[reminders] failed to send for appointment ${appt.id}:`, err);
    }
  }

  if (sent > 0) console.log(`[reminders] sent ${sent} reminder(s)`);
  return sent;
}

export function startReminderCron() {
  cron.schedule(CRON_EXPRESSION, () => {
    runReminderSweep().catch((err) => console.error("[reminders] sweep crashed:", err));
  });
  console.log(
    `[reminders] cron scheduled "${CRON_EXPRESSION}" (reminds ${REMINDER_HOURS_BEFORE}h before appointment)`
  );
}
