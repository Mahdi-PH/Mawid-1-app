"use client";

// Auto-saves a local PDF backup of a clinic's just-submitted signup data,
// right after registerClinic() succeeds — a professional safeguard against
// losing that data, per the user's explicit ask. jsPDF's own text()
// doesn't shape Arabic (the letters would render disconnected/reversed,
// since Arabic needs contextual glyph joining that only a real text-layout
// engine — i.e. the browser itself — does correctly), so this renders the
// data as an off-screen HTML table first, rasterizes it with html2canvas
// (the browser does the Arabic shaping for free), and embeds that image
// into a one-page PDF via jsPDF. jsPDF's .save() triggers a normal browser
// download — the only way a web app can hand a file to "تخزينه محلياً على
// جهاز المستخدم" (local device storage) without a server round-trip.
export interface SignupPdfFields {
  clinicName: string;
  email: string;
  gov: string | null;
  district: string | null;
  street: string | null;
  workStart: string;
  workEnd: string;
  slotMin: number;
  bookingSlug?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function saveSignupAccountPdf(fields: SignupPdfFields): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const rows: [string, string][] = [
    ["اسم العيادة / المركز", fields.clinicName],
    ["البريد الإلكتروني", fields.email],
    ["المحافظة", fields.gov || "—"],
    ["الحي", fields.district || "—"],
    ["الشارع", fields.street || "—"],
    ["بداية الدوام", fields.workStart],
    ["نهاية الدوام", fields.workEnd],
    ["مدة الموعد الواحد", `${fields.slotMin} دقائق`],
    [
      "تاريخ التسجيل",
      new Date().toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" }),
    ],
  ];
  if (fields.bookingSlug && typeof window !== "undefined") {
    rows.push(["رابط الحجز", `${window.location.origin}/find/book?clinic=${fields.bookingSlug}`]);
  }

  const container = document.createElement("div");
  container.setAttribute("dir", "rtl");
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "-99999px";
  container.style.width = "720px";
  container.style.padding = "40px";
  container.style.background = "#ffffff";
  container.style.fontFamily = "Tajawal, 'Segoe UI', sans-serif";
  container.innerHTML = `
    <div style="text-align:center;margin-bottom:28px;">
      <div style="font-size:26px;font-weight:700;color:#0F7A6C;">مَوْعِد</div>
      <div style="font-size:15px;color:#6b7280;margin-top:4px;">بيانات حساب العيادة / مركز التجميل</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:15px;">
      ${rows
        .map(
          ([label, value]) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;width:38%;">${escapeHtml(label)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;">${escapeHtml(value)}</td>
        </tr>`
        )
        .join("")}
    </table>
    <div style="margin-top:24px;font-size:12px;color:#9ca3af;text-align:center;">
      تم إنشاء هذا الملف تلقائياً عند التسجيل — احتفظ به كنسخة احتياطية من بيانات حسابك.
    </div>
  `;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: "#ffffff" });
    // JPEG, not PNG: jsPDF stores an added PNG's raw pixel data rather than
    // re-deflating it, which balloons a simple table to several MB (verified
    // directly — a 143KB PNG produced a 5.6MB PDF). JPEG at high quality is
    // the standard fix for this exact html2canvas+jsPDF combination and
    // stays crisp for flat text-on-white content like this.
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    // A4 portrait in points (jsPDF's default unit here) is 595.28 x 841.89 —
    // hardcoded rather than queried from pdf.internal.pageSize so this
    // doesn't depend on that accessor's exact shape across jsPDF versions.
    const pageWidthPt = 595.28;
    const marginPt = 20;
    const imgWidthPt = pageWidthPt - marginPt * 2;
    const imgHeightPt = (canvas.height * imgWidthPt) / canvas.width;
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    pdf.addImage(imgData, "JPEG", marginPt, marginPt, imgWidthPt, imgHeightPt);
    const dateStamp = new Date().toISOString().slice(0, 10);
    pdf.save(`بيانات-حساب-موعد-${dateStamp}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}
