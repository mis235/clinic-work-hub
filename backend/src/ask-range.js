// Understands "today", "yesterday", "this week", "last 7 days", "this month", "last month",
// "from 1 nov to 3 nov", "between 2026-11-01 and 2026-11-03", "on 5th november" in a typed question.
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Every date written in the text, in order of appearance.
export function findDates(m, today) {
  const y0 = Number(today.slice(0, 4)), out = [];
  const re = /(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?|(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s*)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s*,?\s*(\d{4}))?|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?/g;
  let x;
  while ((x = re.exec(m))) {
    let y, mo, d;
    if (x[1]) { y = +x[1]; mo = +x[2]; d = +x[3]; }
    else if (x[4]) { d = +x[4]; mo = +x[5]; y = x[6] ? (+x[6] < 100 ? 2000 + +x[6] : +x[6]) : y0; }
    else if (x[7]) { d = +x[7]; mo = MONTHS.indexOf(x[8]) + 1; y = x[9] ? +x[9] : y0; }
    else { mo = MONTHS.indexOf(x[10]) + 1; d = +x[11]; y = x[12] ? +x[12] : y0; }
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push(iso(y, mo, d));
  }
  return out;
}

export function parseRange(m, today) {
  const dates = findDates(m, today);
  if (dates.length >= 2 || (dates.length === 1 && /\b(from|since)\b/.test(m))) {
    const a = dates[0], b = dates[1] || today;
    return a <= b ? { from: a, to: b, label: `${a} to ${b}` } : { from: b, to: a, label: `${b} to ${a}` };
  }
  if (dates.length === 1) return { from: dates[0], to: dates[0], label: dates[0] };
  const mon = today.slice(0, 7);
  if (/yesterday/.test(m)) { const d = addDays(today, -1); return { from: d, to: d, label: "yesterday" }; }
  if (/last\s*(7|seven)\s*days|past\s*(7|seven)\s*days|last week|past week/.test(m)) return { from: addDays(today, -6), to: today, label: "the last 7 days" };
  if (/last\s*(30|thirty)\s*days|past\s*(30|thirty)\s*days/.test(m)) return { from: addDays(today, -29), to: today, label: "the last 30 days" };
  if (/this week/.test(m)) { const wd = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7; return { from: addDays(today, -wd), to: today, label: "this week" }; }
  if (/last month|previous month/.test(m)) { const d = new Date(mon + "-01T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 1); const lm = d.toISOString().slice(0, 7); return { from: lm + "-01", to: addDays(mon + "-01", -1), label: lm }; }
  if (/this month|month so far|monthly|\bmonth\b/.test(m)) return { from: mon + "-01", to: today, label: "this month" };
  return { from: today, to: today, label: "today" };
}
export { addDays };
