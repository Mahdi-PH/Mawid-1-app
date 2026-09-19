import express from "express";
import cors from "cors";
import { appointmentsRouter } from "./modules/appointments/appointments.routes";
import { patientsRouter } from "./modules/patients/patients.routes";
import { doctorsRouter } from "./modules/doctors/doctors.routes";
import { visitsRouter } from "./modules/visits/visits.routes";
import { displayRouter } from "./modules/display/display.routes";
import { syncRouter } from "./modules/sync/sync.routes";
import { startReminderCron } from "./modules/reminders/reminders.cron";
import { errorHandler } from "./middleware/errorHandler";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, service: "mawid-server" }));

app.use("/api/doctors", doctorsRouter);
app.use("/api/patients", patientsRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/visits", visitsRouter);
app.use("/api/display", displayRouter);
app.use("/api/sync", syncRouter);

app.use(errorHandler);

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  console.log(`[mawid-server] listening on :${PORT}`);
  if (process.env.WHATSAPP_ACCESS_TOKEN) {
    startReminderCron();
  } else {
    console.log("[reminders] WHATSAPP_ACCESS_TOKEN not set — reminder cron disabled");
  }
});
