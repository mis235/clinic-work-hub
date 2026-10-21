// The leave application letter (PDF), laid out like the clinic's leave form, with the clinic logo as a faint watermark.
// Signatures appear only for people who have actually signed.
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO = path.join(__dirname, "..", "assets", "logo.png");
const dmy = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function buildLeaveLetter({ r, reason, chain, hrName, applicantSig }) {
  const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: `Leave application - ${r.staff_name}`, Author: "Dr. Nishita's Clinic" } });
  const W = doc.page.width, H = doc.page.height;

  // watermark: big, faint, centred
  if (fs.existsSync(LOGO)) {
    doc.save(); doc.opacity(0.08);
    const size = 380;
    try { doc.image(LOGO, (W - size) / 2, (H - size) / 2, { fit: [size, size], align: "center", valign: "center" }); } catch {}
    doc.restore();
  }

  doc.fillColor("#1f2937").font("Helvetica-Bold").fontSize(20).text("Leave Application Form", { align: "center" });
  doc.moveDown(0.2).font("Helvetica").fontSize(10).fillColor("#6b7280").text("Dr. Nishita's Clinic", { align: "center" });
  doc.moveTo(56, doc.y + 8).lineTo(W - 56, doc.y + 8).strokeColor("#d1d5db").stroke();
  doc.moveDown(1.6).fillColor("#111827").fontSize(12);

  doc.font("Helvetica-Bold").text("TO:"); doc.font("Helvetica").text("The Director"); doc.text("Dr. Nishita's Clinic");
  doc.moveDown(0.8).font("Helvetica-Bold").text("Subject: ", { continued: true }).font("Helvetica").text("Leave application");
  doc.moveDown(0.6).font("Helvetica-Bold").text("Dated: ", { continued: true }).font("Helvetica").text(dmy(String(r.created_at).slice(0, 10)));
  doc.moveDown(1).text("Respected Madam / Sir,");
  const cover = r.cover_name ? r.cover_name : "my colleagues";
  const why = [reason, r.reason].filter(Boolean).join(" - ") || "I have a personal need";
  doc.moveDown(0.8).text(
    `Myself ${r.staff_name}, working as ${r.designation ? "a " + r.designation : "a staff member"}${r.department ? " (" + r.department + ")" : ""} in your office.`, { lineGap: 4 });
  doc.moveDown(0.6).text(
    `This is to bring to your notice that ${why}, and I will be on leave from ${dmy(r.from_date)} to ${dmy(r.to_date)} (${r.days} day${r.days === 1 ? "" : "s"}${r.days === 0.5 ? ", half day" : ""}). ` +
    `I have briefed the team about this and assigned my work to ${cover} accordingly. In case of emergency you can contact me, but it is not possible to attend office in person. ` +
    `I would be obliged if you accept my request.`, { lineGap: 4, align: "justify" });
  if (r.cover_note) doc.moveDown(0.5).fillColor("#374151").fontSize(11).text(`Handover note: ${r.cover_note}`, { lineGap: 3 }).fillColor("#111827").fontSize(12);
  doc.moveDown(0.8).text("Thank you.");

  // signature area
  const top = Math.max(doc.y + 30, 470);
  doc.font("Helvetica").fontSize(12).fillColor("#111827").text("Regards", 56, top);
  if (applicantSig) { try { doc.image(applicantSig, 56, top + 14, { fit: [130, 46] }); } catch {} }
  doc.moveTo(56, top + 66).lineTo(206, top + 66).strokeColor("#111827").stroke();
  doc.fontSize(10).text(r.staff_name, 56, top + 70, { width: 150 });

  doc.fontSize(12).text("Concerned officer signature", 240, top, { width: W - 296, align: "right" });
  const slots = [{ label: "HR (letter received)", name: hrName, signed: !!r.hr_confirmed_at, at: r.hr_confirmed_at, file: null }, ...chain.map((c) => ({ label: c.label, name: c.name, signed: c.status === "approved", rejected: c.status === "rejected", at: c.decided_at, file: c.file }))];
  const cols = Math.min(slots.length, 4), cw = (W - 112) / cols;
  const sy = top + 110;
  slots.slice(0, 8).forEach((s, i) => {
    const x = 56 + (i % cols) * cw, y = sy + Math.floor(i / cols) * 110;
    if (s.signed && s.file && fs.existsSync(s.file)) { try { doc.image(s.file, x + 4, y, { fit: [cw - 24, 48] }); } catch {} }
    else if (s.signed) doc.font("Helvetica-Oblique").fontSize(10).fillColor("#15803d").text("Received", x + 4, y + 18);
    else if (s.rejected) doc.font("Helvetica-Bold").fontSize(10).fillColor("#b91c1c").text("Not approved", x + 4, y + 18);
    doc.moveTo(x, y + 54).lineTo(x + cw - 16, y + 54).strokeColor("#111827").stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827").text(s.label, x, y + 58, { width: cw - 16 });
    doc.font("Helvetica").fontSize(9).fillColor("#4b5563").text(s.name || "", x, y + 70, { width: cw - 16 });
    if (s.at) doc.fontSize(8).text(String(s.at).slice(0, 10).split("-").reverse().join("-"), x, y + 82, { width: cw - 16 });
  });

  const final = r.status === "approved" ? ["APPROVED", "#15803d"] : r.status === "rejected" ? ["NOT APPROVED", "#b91c1c"] : r.status === "cancelled" ? ["CANCELLED", "#6b7280"] : ["WAITING FOR APPROVAL", "#b45309"];
  doc.font("Helvetica-Bold").fontSize(10).fillColor(final[1]).text(`Status: ${final[0]}`, 56, H - 70, { width: W - 112, align: "center" });
  doc.end();
  return doc;
}
