// Thin client for the WhatsApp Business Cloud API (Meta). Kept isolated
// behind sendWhatsAppTemplate() so swapping providers (e.g. Twilio) later
// only touches this file.

const WHATSAPP_API_VERSION = "v20.0";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
// Must be a pre-approved Meta message template, e.g. "appointment_reminder"
// with placeholders {{1}}=patient name, {{2}}=clinic name, {{3}}=time.
const REMINDER_TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME ?? "appointment_reminder";

export interface ReminderMessageParams {
  patientName: string;
  clinicName: string;
  doctorName: string;
  date: string;
  startTime: string;
}

/** Normalizes to E.164-ish digits-only (no leading +) as required by the Graph API "to" field. */
function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

export async function sendWhatsAppReminder(toPhone: string, params: ReminderMessageParams) {
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    throw new Error(
      "WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN are not configured (see .env.example)."
    );
  }

  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${PHONE_NUMBER_ID}/messages`;

  const body = {
    messaging_product: "whatsapp",
    to: normalizePhone(toPhone),
    type: "template",
    template: {
      name: REMINDER_TEMPLATE_NAME,
      language: { code: "ar" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: params.patientName },
            { type: "text", text: params.clinicName },
            { type: "text", text: `${params.date} ${params.startTime}` },
            { type: "text", text: params.doctorName },
          ],
        },
      ],
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WhatsApp API error ${res.status}: ${errText}`);
  }

  return res.json();
}
