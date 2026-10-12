import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "payslips");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function inr(n) {
  return `Rs. ${Number(n || 0).toLocaleString("en-IN")}`;
}

function numberToWordsIndian(num) {
  // Small, dependency-free number-to-words for payslip amounts (rupees only).
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function twoDigits(n) {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
  }
  function threeDigits(n) {
    if (n >= 100) return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + twoDigits(n % 100) : "");
    return twoDigits(n);
  }
  if (num === 0) return "Zero";
  let n = Math.round(num);
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const rest = n;
  let words = "";
  if (crore) words += threeDigits(crore) + " Crore ";
  if (lakh) words += threeDigits(lakh) + " Lakh ";
  if (thousand) words += threeDigits(thousand) + " Thousand ";
  if (rest) words += threeDigits(rest);
  return words.trim();
}

/**
 * Generates a payslip PDF matching the layout of the clinic's existing
 * template (company letterhead, employee info block, earnings/deductions
 * table, net payable). Returns the absolute file path.
 */
export function generatePayslipPdf({ company, employee, payslip }) {
  const fileName = `${employee.name.replace(/\s+/g, "_")}_${payslip.pay_period}_${payslip.id.slice(0, 6)}.pdf`;
  const filePath = path.join(OUT_DIR, fileName);

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(fs.createWriteStream(filePath));

  // --- Letterhead ---
  doc.fontSize(20).fillColor("#B4872C").text(company.name, { align: "center" });
  if (company.address) {
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor("#5B6675").text(company.address, { align: "center" });
  }
  doc.moveDown(1);
  doc.fontSize(13).fillColor("#1B2430").text(
    `Payslip for the month of ${new Date(payslip.pay_period + "-01").toLocaleString("en-IN", { month: "long", year: "numeric" })}`,
    { underline: false }
  );
  doc.moveDown(0.5);

  // --- Employee info block ---
  const infoTop = doc.y;
  const col1X = 50, col2X = 310;
  const rows = [
    ["Employee Name", employee.name, "Employee ID", employee.employeeCode || "-"],
    ["Position", employee.position || "-", "PAN", employee.pan || "-"],
    ["Date of Joining", employee.joinedAt || "-", "Contact No", employee.phone || "-"],
    ["Pay Date", payslip.pay_date, "Pay Period", payslip.pay_period],
  ];
  doc.fontSize(10);
  let y = infoTop;
  for (const [l1, v1, l2, v2] of rows) {
    doc.font("Helvetica-Bold").text(`${l1}:`, col1X, y, { continued: true }).font("Helvetica").text(` ${v1}`);
    doc.font("Helvetica-Bold").text(`${l2}:`, col2X, y, { continued: true }).font("Helvetica").text(` ${v2}`);
    y += 18;
  }
  doc.moveDown(2);

  // --- Earnings / Deductions table ---
  const tableTop = doc.y + 10;
  const earnings = [
    ["Basic Salary", payslip.basic_salary],
    ["Leave Bonus", payslip.leave_bonus],
    ["Over Time", payslip.overtime],
    ["Other Allowances", payslip.other_allowances],
  ];
  const deductions = [
    ["PF", payslip.pf],
    ["TDS", payslip.tds],
    ["Other deductions", payslip.other_deductions],
    ["Retention", payslip.retention],
  ];
  const totalEarnings = earnings.reduce((s, [, v]) => s + v, 0);
  const totalDeductions = deductions.reduce((s, [, v]) => s + v, 0);

  const colA = 50, colB = 200, colC = 320, colD = 480;
  doc.font("Helvetica-Bold").fontSize(10);
  doc.text("Earnings", colA, tableTop).text("Amount", colB, tableTop);
  doc.text("Deductions", colC, tableTop).text("Amount", colD, tableTop);
  doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();

  let ry = tableTop + 22;
  doc.font("Helvetica").fontSize(10);
  for (let i = 0; i < 4; i++) {
    doc.text(earnings[i][0], colA, ry).text(earnings[i][1] ? inr(earnings[i][1]) : "-", colB, ry);
    doc.text(deductions[i][0], colC, ry).text(deductions[i][1] ? inr(deductions[i][1]) : "-", colD, ry);
    ry += 18;
  }
  doc.moveTo(50, ry).lineTo(545, ry).stroke();
  ry += 8;
  doc.font("Helvetica-Bold");
  doc.text("Total Earnings", colA, ry).text(inr(totalEarnings), colB, ry);
  doc.text("Total Deductions", colC, ry).text(inr(totalDeductions), colD, ry);
  ry += 24;

  doc.moveTo(50, ry).lineTo(545, ry).stroke();
  ry += 8;
  doc.fontSize(11).text("Net Payable (Earnings)", colA, ry, { continued: true }).text(`   ${inr(payslip.net_payable)}`, { align: "left" });
  ry += 18;
  doc.font("Helvetica").fontSize(9).fillColor("#5B6675").text(`${numberToWordsIndian(payslip.net_payable)} Only`, colA, ry);
  ry += 30;

  doc.moveTo(50, ry).lineTo(545, ry).stroke();
  ry += 10;
  doc.fontSize(8).fillColor("#5B6675").text("This is a Computer Generated Payslip", colA, ry, { width: 495, align: "center" });

  doc.end();
  return filePath;
}
