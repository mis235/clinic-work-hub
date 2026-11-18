import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, ".."), "payslips"); // inside the data folder so backups and the cloud disk include it
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const ASSETS = path.join(__dirname, "..", "assets", "payslip");

export const DEFAULT_ADDRESS = "Road No.7 , 1st floor, Sowbhagya Abode, Beside Iran Embassy , Banjarahills,\nHyderabad, Telangana - 500034";
export const DEFAULT_FOOTER = "This is a Computer Generated  Payslip";
export const isPharmacy = (company) => /shanta|pharmacy/i.test(company?.name || "");

/** The earning lines each company's template shows (pharmacy has Other Allowances; the clinics have Incentive and Arrears). */
export const EARNING_FIELDS = {
  pharmacy: [["basic_salary", "Basic Salary"], ["leave_bonus", "Leave Bonus"], ["overtime", "Over Time"], ["other_allowances", "Other Allowances"]],
  clinic: [["basic_salary", "Basic Salary"], ["leave_bonus", "Leave Bonus"], ["overtime", "Over Time"], ["incentive", "Incentive"], ["arrears", "Arrears"]],
};
const ALL_EARNINGS = [["basic_salary", "Basic Salary"], ["leave_bonus", "Leave Bonus"], ["overtime", "Over Time"], ["incentive", "Incentive"], ["arrears", "Arrears"], ["other_allowances", "Other Allowances"]];
/** Template rows plus any other earning that has an amount, so the total on the slip always adds up. */
export function earningRows(company, payslip) {
  const base = EARNING_FIELDS[isPharmacy(company) ? "pharmacy" : "clinic"];
  const extra = ALL_EARNINGS.filter(([k]) => !base.some(([b]) => b === k) && Number(payslip[k] || 0) !== 0);
  return [...base, ...extra];
}

export function numberToWordsIndian(num) {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n) => (n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : ""));
  const three = (n) => (n >= 100 ? ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " and " + two(n % 100) : "") : two(n));
  let n = Math.round(Math.abs(num || 0));
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const parts = [];
  if (crore) parts.push(two(crore) + " Crore");
  if (lakh) parts.push(two(lakh) + " Lakh");
  if (thousand) parts.push(two(thousand) + " Thousand");
  let words = parts.join(" ");
  if (n) words += (words ? (n < 100 ? " and " : " ") : "") + three(n);
  return words.trim();
}

const money = (n) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const dmy = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${m[3]}.${m[2]}.${m[1]}` : iso || "-"; };
const nice = (iso) => { const d = /^\d{4}-\d{2}-\d{2}/.test(iso || "") ? new Date(iso.slice(0, 10) + "T00:00:00Z") : null; return d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : iso || "-"; };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLong = (p) => `${MONTHS[Number(p.slice(5, 7)) - 1]}, ${p.slice(0, 4)}`;
const periodShort = (p) => `${MONTHS[Number(p.slice(5, 7)) - 1].slice(0, 3)}'${p.slice(2, 4)}`;
const tenDigits = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length > 10 ? d.slice(-10) : d || "-"; };

/** Everything that appears in the "employee" block of the slip, after any hand edits saved on the payslip. */
export function slipInfo({ employee, payslip }) {
  let o = {}; try { o = JSON.parse(payslip.info_json || "{}"); } catch { /* ignore */ }
  return {
    name: o.name ?? employee.name, employeeCode: o.employeeCode ?? (employee.employeeCode || "-"), position: o.position ?? (employee.position || "-"),
    pan: o.pan ?? (employee.pan || "-"), joinedAt: o.joinedAt ?? nice(employee.joinedAt), phone: o.phone ?? tenDigits(employee.phone),
    payDate: o.payDate ?? dmy(payslip.pay_date), payPeriod: o.payPeriod ?? periodShort(payslip.pay_period), title: o.title ?? `Payslip for the month of ${monthLong(payslip.pay_period)}`,
  };
}

/** Figures shown on the slip. "Loss of pay" is shown on its own line; it is kept inside other_deductions in the database. */
export function slipFigures(company, payslip) {
  const earn = earningRows(company, payslip).map(([k, label]) => [label, Number(payslip[k] || 0)]);
  const lop = Number(payslip.lop_amount || 0);
  const ded = [["PF", Number(payslip.pf || 0)], ["TDS", Number(payslip.tds || 0)], ["Other deductions", Number(payslip.other_deductions || 0) - lop], ["Loss of pay", lop], ["Retention", Number(payslip.retention || 0)]];
  const totalEarn = earn.reduce((s, [, v]) => s + v, 0), totalDed = ded.reduce((s, [, v]) => s + v, 0);
  return { earn, ded, totalEarn, totalDed, net: totalEarn - totalDed };
}

/**
 * Generates a payslip PDF in the clinic's own template (company logo, address, employee block, earnings and deductions,
 * net payable in figures and words). Returns the absolute file path.
 */
export function generatePayslipPdf({ company, employee, payslip }) {
  const fileName = `${employee.name.replace(/\s+/g, "_")}_${payslip.pay_period}_${payslip.id.slice(0, 6)}.pdf`;
  const filePath = path.join(OUT_DIR, fileName);
  const info = slipInfo({ employee, payslip }), fig = slipFigures(company, payslip);

  const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `Payslip ${payslip.pay_period} - ${info.name}` } });
  doc.pipe(fs.createWriteStream(filePath));
  doc.registerFont("Cal", path.join(ASSETS, "Carlito-Regular.ttf"));
  doc.registerFont("Cal-B", path.join(ASSETS, "Carlito-Bold.ttf"));

  const L = 40, W = 515, R = L + W;
  // --- Letterhead: logo, address ---
  const pharm = isPharmacy(company);
  const logo = path.join(ASSETS, pharm ? "logo_shanta.png" : "logo_nishita.png");
  const lw = pharm ? 270 : 440, lh = lw * (pharm ? 208 / 1205 : 166 / 1924);
  let y = 40;
  if (fs.existsSync(logo)) doc.image(logo, L + (W - lw) / 2, y, { width: lw });
  y += lh + 12;
  doc.font("Cal").fontSize(10.5).fillColor("#000").text(company.address || DEFAULT_ADDRESS, L, y, { width: W, align: "center", lineGap: 2 });
  y = doc.y + 14;
  doc.font("Cal-B").fontSize(14).text(info.title, L, y, { width: W });
  y += 26;

  // --- The bordered slip ---
  const top = y, c1 = L, c2 = L + 162, c3 = L + 273, c4 = L + 395, hair = 0.5;
  const line = (x1, y1, x2, y2, w = hair) => doc.lineWidth(w).strokeColor("#000").moveTo(x1, y1).lineTo(x2, y2).stroke();
  const infoRows = [["Employee Name", info.name, "Employee ID", info.employeeCode], ["Position", info.position, "PAN", info.pan], ["Date of Joining", info.joinedAt, "Contact No", info.phone], ["Pay Date", info.payDate, "Pay Period", info.payPeriod]];
  const rowH = 23;
  const half = L + 290;
  infoRows.forEach(([l1, v1, l2, v2], i) => {
    const ry = top + i * rowH;
    doc.font("Cal-B").fontSize(11).fillColor("#000").text(l1, L + 6, ry + 6, { lineBreak: false });
    doc.font("Cal").text(`: ${v1}`, L + 98, ry + 6, { width: half - L - 104, lineBreak: false, ellipsis: true });
    doc.font("Cal-B").text(l2, half + 6, ry + 6, { lineBreak: false });
    doc.font("Cal").text(`: ${v2}`, half + 82, ry + 6, { width: R - half - 88, lineBreak: false, ellipsis: true });
    line(L, ry + rowH, R, ry + rowH);
  });
  line(half, top, half, top + infoRows.length * rowH);
  let ry = top + infoRows.length * rowH;
  line(L, ry + 14, R, ry + 14); ry += 14;                                   // spacer row

  const headTop = ry, hh = 19;
  doc.font("Cal-B").fontSize(11);
  doc.text("Earnings", c1 + 4, ry + 4, { lineBreak: false });
  doc.text("Amount", c2, ry + 4, { width: c3 - c2, align: "center", lineBreak: false });
  doc.text("Deductions", c3 + 4, ry + 4, { lineBreak: false });
  doc.text("Amount", c4, ry + 4, { width: R - c4, align: "center", lineBreak: false });
  line(L, ry + hh, R, ry + hh); ry += hh;

  const amount = (v, x0, x1, yy, bold) => {
    doc.font(bold ? "Cal-B" : "Cal").fontSize(11);
    if (!v) { doc.text("-", x0, yy, { width: x1 - x0 - 8, align: "right", lineBreak: false }); return; }
    doc.text("₹", x0 + 6, yy, { lineBreak: false });
    doc.text(money(v), x0, yy, { width: x1 - x0 - 8, align: "right", lineBreak: false });
  };
  const ih = 17, n = Math.max(fig.earn.length, fig.ded.length);
  for (let i = 0; i < n; i++) {
    const yy = ry + 2.5;
    doc.font("Cal").fontSize(11).fillColor("#000");
    if (fig.earn[i]) { doc.text(fig.earn[i][0], c1 + 4, yy, { lineBreak: false }); amount(fig.earn[i][1], c2, c3, yy); }
    if (fig.ded[i]) { doc.text(fig.ded[i][0], c3 + 4, yy, { lineBreak: false }); amount(fig.ded[i][1], c4, R, yy); }
    ry += ih; line(L, ry, R, ry);
  }
  ry += 0; line(L, ry + 14, R, ry + 14); ry += 14;                           // spacer row
  const totTop = ry;
  doc.font("Cal-B").fontSize(11);
  doc.text("Total Earnings", c1 + 4, ry + 3, { lineBreak: false }); amount(fig.totalEarn, c2, c3, ry + 3, true);
  doc.font("Cal-B").text("Total Deductions", c3 + 4, ry + 3, { lineBreak: false }); amount(fig.totalDed, c4, R, ry + 3, true);
  ry += 19; line(L, ry, R, ry);
  doc.font("Cal-B").fontSize(11).text("Net Payable (Earnings)", c1 + 4, ry + 3, { lineBreak: false }); amount(fig.net, c4, R, ry + 3, true);
  ry += 19;
  doc.font("Cal").fontSize(11).text(`${numberToWordsIndian(fig.net)} Only`, c1 + 4, ry + 1, { width: W - 8, lineBreak: false });
  ry += 22;
  line(L, ry, R, ry);
  doc.font("Helvetica-Bold").fontSize(8).text(company.payslip_footer || DEFAULT_FOOTER, L, ry + 11, { width: W, align: "center", lineBreak: false });
  ry += 30;

  // vertical rules and the outer box
  line(c3, headTop, c3, totTop + 19);
  line(c2, headTop, c2, totTop - 14 + 0); line(c4, headTop, c4, totTop - 14);
  line(c2, totTop, c2, totTop + 19); line(c4, totTop, c4, totTop + 38);
  doc.lineWidth(1.4).strokeColor("#000").rect(L, top, W, ry - top).stroke();
  doc.end();
  return filePath;
}

/** Net pay = every earning minus every deduction (same rule everywhere). */
export function computeNet(p) {
  const earnings = ["basic_salary", "leave_bonus", "overtime", "other_allowances", "incentive", "arrears"].reduce((s, k) => s + Number(p[k] || 0), 0);
  const deductions = ["pf", "tds", "other_deductions", "retention"].reduce((s, k) => s + Number(p[k] || 0), 0);
  return earnings - deductions;
}
