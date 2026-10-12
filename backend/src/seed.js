import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import db from "./db.js";

// ---------------------------------------------------------------------------
// Real roster, pulled from Staff_KRA-KPI.xlsx (Arshad's role already merged
// into Asif's per the earlier edit). Phone numbers below are PLACEHOLDERS —
// replace every one with the real WhatsApp number before going live; nothing
// will send correctly until you do. Six positions from the sheet had no name
// filled in (Frontdesk Executive, Process Coordinator, Lead Therapist,
// Patient Experience Manager & Therapists, one unnamed Therapist, Driver) —
// those can't get a login yet since there's no person to log in as, but their
// responsibilities are still seeded below as checklist templates so the
// content isn't lost; add the user once you tell me who fills each role.
// ---------------------------------------------------------------------------
const DEPARTMENTS = [
  "Management", "Front Desk", "Therapist", "MDO", "Doctors", "Pharmacy",
  "Floor Coordinator", "Finance", "Supporting Staff",
];

const ROLES = ["admin", "manager", "staff"];

const PERMISSIONS = [
  "task:assign", "task:view_all", "task:view_own", "task:update_own",
  "staff:manage", "department:manage",
  "attendance:view_own", "attendance:view_all", "attendance:checkin", "attendance:manual_override",
  "leave:apply", "leave:approve",
  "performance:view_own", "performance:view_all",
  "payroll:view_own", "payroll:view_all",
  "reports:view", "announcements:send", "settings:manage", "advisors:use", "policies:manage", "payroll:manage",
  "assistant:use",
  "shiftchecklist:submit", "shiftchecklist:view_all",
];

const ROLE_PERMISSIONS = {
  admin: PERMISSIONS,
  manager: [
    "task:assign", "task:view_all", "task:view_own", "task:update_own",
    "attendance:view_all", "attendance:checkin", "attendance:manual_override", "leave:approve",
    "performance:view_all", "reports:view", "announcements:send", "advisors:use", "assistant:use",
    "shiftchecklist:submit", "shiftchecklist:view_all",
  ],
  staff: [
    "task:view_own", "task:update_own",
    "attendance:view_own", "attendance:checkin", "leave:apply", "performance:view_own", "payroll:view_own",
    "assistant:use", "shiftchecklist:submit",
  ],
};

// role: 'manager' given to the three staff with clear team-supervision duties
// in their KRA (Naga/COS runs the whole clinic ops, Asif manages pharmacy,
// Monika oversees the floor). Everyone else is 'staff'. Change any of these
// with PATCH /api/users/:id/role once the app is running, no code change needed.
// Management group: Dr. Nishita (owner/admin), Shreyas Bagamar, Naga (COS),
// and Neelima (MIS) all sit under the "Management" department together, per
// your note. Shreyas has no login details on file yet — he's seeded with a
// placeholder phone/PIN like the rest, as "manager" role (adjust to "admin"
// from the Staff screen if he should have full admin rights instead); his
// real designation and checklist responsibilities are still a draft below,
// flagged for you to confirm or replace.
const USERS = [
  { name: "Dr. Nishita (Admin)", role: "admin", dept: "Management", email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, phone: "+919000020000" },
  { name: "Shreyas Bagamar", designation: "Director (confirm exact title)", role: "manager", dept: "Management", phone: "+919000020019" },
  { name: "Jyothi", designation: "Counsellor & Front Office Executive", role: "staff", dept: "Front Desk", phone: "+919000020001" },
  { name: "Kavya", designation: "Billing & Front office Executive", role: "staff", dept: "Front Desk", phone: "+919000020002" },
  { name: "Pratyusha", designation: "Patient Relation Executive", role: "staff", dept: "Front Desk", phone: "+919000020003" },
  { name: "Amena", designation: "Patient Relation Executive", role: "staff", dept: "Front Desk", phone: "+919000020004" },
  { name: "Chun", designation: "Therapist", role: "staff", dept: "Therapist", phone: "+919000020005" },
  { name: "Zoya", designation: "Therapist", role: "staff", dept: "Therapist", phone: "+919000020006" },
  { name: "Akshita", designation: "EA", role: "staff", dept: "MDO", phone: "+919000020007" },
  { name: "Dr.Shirisha", designation: "Junior Doctor", role: "staff", dept: "Doctors", phone: "+919000020008" },
  { name: "Dr.Arshiya", designation: "Junior Doctor", role: "staff", dept: "Doctors", phone: "+919000020009" },
  { name: "Dr.Bhavi", designation: "Junior Doctor", role: "staff", dept: "Doctors", phone: "+919000020010" },
  { name: "Asif", designation: "Pharmacy Manager (incl. Pharmacist duties)", role: "manager", dept: "Pharmacy", phone: "+919000020011" },
  { name: "Monika", designation: "Stock Controller & Floor Co-ordinator", role: "manager", dept: "Floor Coordinator", phone: "+919000020012" },
  { name: "Sudha Rani", designation: "Accounts", role: "staff", dept: "Finance", phone: "+919000020013" },
  { name: "Neelima", designation: "MIS", role: "staff", dept: "Management", phone: "+918497926075" },
  { name: "Naga", designation: "COS", role: "manager", dept: "Management", phone: "+919000020015" },
  { name: "Sumit", designation: "Security", role: "staff", dept: "Supporting Staff", phone: "+919000020016" },
  { name: "Pavani", designation: "House Keeping", role: "staff", dept: "Supporting Staff", phone: "+919000020017" },
  { name: "Lakshmi", designation: "House Keeping", role: "staff", dept: "Supporting Staff", phone: "+919000020018" },
  // --- Found while porting the real shift-checklist submission log: these four
  // people actively submit daily checklists in the live Apps Script system but
  // had no account here at all. Added so their real checklist history has
  // somewhere to attach — phone numbers are PLACEHOLDERS like the rest above,
  // and department is a best guess; correct both from the Staff screen.
  { name: "Geetha", designation: "Photography / Documentation Coordinator", role: "staff", dept: "Floor Coordinator", phone: "+919000020020" },
  { name: "Ayesha", designation: "Patient Flow Coordinator", role: "staff", dept: "Floor Coordinator", phone: "+919000020021" },
  { name: "Aboli", designation: "HR Executive", role: "manager", dept: "Management", phone: "+919000020022" },
  { name: "Sivamma", designation: "Evening Housekeeping", role: "staff", dept: "Supporting Staff", phone: "+919000020023" },
];

// Maps each user (by name) to the real shift-checklist role template they fill
// in once per shift, ported 1:1 from the live Apps Script system's submission
// log — grounded in who actually submitted which "Role" there, not a guess.
// Names left out (doctors, front-desk/relation staff, therapists, management)
// didn't appear as submitters in the log, so they get no shift checklist here;
// add one from the Staff screen if that's wrong.
const USER_SHIFT_ROLE = {
  "Monika": "3rd Floor — Procedure & Stock Controller",
  "Pavani": "Housekeeping Coordinator",
  "Lakshmi": "Housekeeping Coordinator",
  "Asif": "Pharmacy Coordinator",
  "Pratyusha": "Procedure Scheduling & Recall Coordinator",
  "Amena": "Consultation Scheduling & Recall Coordinator",
  "Sumit": "Security & Facilities Coordinator",
  "Kavya": "Reception, Billing & Records Coordinator",
  "Jyothi": "Patient Counsellor & Treatment Conversion Coordinator",
  "Geetha": "Photography / Documentation Coordinator",
  "Ayesha": "Patient Flow Coordinator",
  "Sudha Rani": "Accounts Executive",
  "Aboli": "HR Executive",
  "Sivamma": "Evening Housekeeping",
};

// Every responsibility line from the sheet, for checklist templates — including
// the six unnamed positions, so nothing from the source data is lost even
// though they don't have a user account yet.
const TEMPLATE_SOURCE = [
  { dept: "Front Desk", designation: "Counsellor & Front Office Executive", text: "1. Greet patients & explain treatments/procedures.\n2. Convert doctor's suggestions into treatment acceptance (upselling)\n3. Handle Payment discussions for packages\n4. Maintain patient relationship & follow-up for continuity of care\n5. Keep proper counselling records (conversion tracking)\n6. Handle escalations, special requests, or complaints on the spot." },
  { dept: "Front Desk", designation: "Billing & Front office Executive", text: "1. Greet patients & Maintain a professional and caring first impression.\n2. Get Profile and medical history forms filled & verified.\n3. Enter Patient data into software accurately.\n4. Guide patient flow to doctor\n5. Generate invoices, collect payments, issue receipts\n6. Submit daily patient & collection summary\n7. Update package sheets daily (sessions used, balance sessions)\n8. Enter next day consultation & procedure schedules into software" },
  { dept: "Front Desk", designation: "Patient Relation Executive", text: "1. Appointment Scheduling & Confirmation\n2. Call patients to book consultations and procedures.\n3. Manage new bookings, reschedules, cancellations according to doctors schedule\n4. Ensure slot availability & avoid double bookings.\n5. Call patients 1 day prior & on the same day of appointment/procedure.\n6. Inform doctor if patient is running late or has arrived.\n7. Call patients suggested for procedures but not yet booked - encourage booking\n8. Maintain a follow-up tracker for conversions.\n9. Call patients post-procedure / consultation to check satisfaction\n10. Record patient feedback in system\n11. Escalate complaints to Manager immediately" },
  { dept: "Front Desk", designation: "Frontdesk Executive (unfilled position)", text: "1. Take patient concern photos (before/after) as advised by doctors.\n2. Upload & ensure photos are properly tagged with patient details in software\n3. Maintain a record of suggested vs. actual procedures done\n4. Prepare and submit monthly report on suggested vs actual procedures done" },
  { dept: "Front Desk", designation: "Process Coordinator (unfilled position)", text: "1. Conduct daily huddles/check-ins with the team.\n2. Monitor and verify daily tasks of Front Desk & Patient Relations executives\n3. Audit package sheet updates, form collection, and schedule entries\n4. Cross-check all next day appointments & procedures in software\n5. Maintain checklists for both executives and verify completion.\n6. Step in to resolve escalated patient issues immediately" },
  { dept: "Therapist", designation: "Lead Therapist (unfilled position)", text: "1. Perform procedures as per doctor's suggestion\n2. Supervise and guide junior therapists during procedure\n3. Ensure procedure rooms are clean, hygienic, and ready for patients.\n4. Maintain daily procedure records\n5. Train and mentor new/junior therapists." },
  { dept: "Therapist", designation: "Patient Experience Manager & Therapists (unfilled position)", text: "1. Ensure the patient is guided and prepared before procedure\n2. Ensure treatment room is clean, set up, and comfortable.\n3. Monitor patient comfort, privacy, and hygiene throughout.\n4. Record procedure completion, update package/session balance in software\n5. Verify consumables & stock usage, inform Stock controller of shortages." },
  { dept: "Therapist", designation: "Therapist", text: "1. Perform procedures as suggested by doctor\n2. Prepare procedure rooms before every session (clean, hygienic, equipped)\n3. Explain treatment steps to patients politely and reassure them\n4. Record procedure done\n5. Report unusual reactions, patient concerns, or complications to doctor immediately\n6. Assist housekeeping with weekly deep cleaning of procedure rooms." },
  { dept: "MDO", designation: "EA", text: "1. Manage doctor's calendar (consultations, procedures, meetings, training)\n2. Coordinate with front desk, patient relations executive, and therapists.\n3. Screen, prioritize, and manage calls, emails, and messages for the doctor.\n4. Prepare patient files, reports, and documentation in advance of appointments.\n5. Track and follow up on doctor-assigned tasks with staff." },
  { dept: "Doctors", designation: "Junior Doctor", text: "1. Conduct initial patient consultations, take detailed history, and record case notes\n2. Assist senior doctor in procedures, pre-procedure prep, and post-procedure care\n3. Explain procedure plans and aftercare instructions to patients\n4. Ensure accurate entry of consultation notes in software\n5. Handle follow-up visits and escalate complex cases to senior doctor" },
  { dept: "Pharmacy", designation: "Pharmacy Manager (incl. Pharmacist duties)", text: "1. Manage overall functioning of the in-clinic pharmacy.\n2. Ensure stock availability, maintain minimum stock levels, and avoid expiries\n3. Verify and process vendor invoices, update purchase/stock registers\n4. Conduct weekly physical stock counts and reconcile with system records\n5. Dispense medicines accurately to patients as per doctor's prescription.\n6. Check expiry dates regularly and separate near-expiry medicines.\n7. Update accounts collection daily" },
  { dept: "Floor Coordinator", designation: "Stock Controller & Floor Co-ordinator", text: "1. Maintain records of consumables, clinic supplies, and procedure material\n2. Check expiry dates of consumables and medicines, segregate near-expiry items\n3. Conduct weekly physical stock counts and reconcile with system records\n4. Ensure procedure rooms are equipped, sanitized, and ready before patient arrival\n5. Escalate any machine/equipment breakdowns to service providers immediately." },
  { dept: "Finance", designation: "Accounts", text: "1. Record all patient collections (cash, card, UPI, online transfers).\n2. Reconcile billing system collections with bank/cash daily.\n3. Maintain petty cash book and submit daily cash balance.\n4. Track due dates and ensure timely vendor payments\n5. Maintain TDS, GST, and other statutory compliance records.\n6. Generate daily/weekly/monthly collection and expense reports for management." },
  { dept: "Management", designation: "MIS", text: "1. Design and maintain dashboards for management (collections, procedures, patient visits, pharmacy)\n2. Consolidate reports from different departments.\n3. Generate daily, weekly, and monthly MIS reports.\n4. Identify manual processes that can be automated (checklists, reminders, reporting)." },
  { dept: "Management", designation: "COS", text: "1. Oversee daily operations across all departments and ensure SOP compliance\n2. Prepare & review financial reports (monthly collections, expenses, outstanding)\n3. Ensure statutory compliance with GST, TDS, and audit timelines\n4. Set & track performance targets (revenue, procedures, pharmacy sales)\n5. Lead HR functions - recruit, hire, onboard, conduct appraisals, manage discipline." },
  // DRAFT — Shreyas's actual responsibilities haven't been provided yet; these
  // are a sensible placeholder for a senior oversight role so he isn't left
  // with an empty checklist. Replace via the Staff/Checklist admin screens
  // once his real KRA is confirmed.
  { dept: "Management", designation: "Director (confirm exact title)", text: "1. Review the daily clinic performance summary (tasks, attendance, collections) each morning.\n2. Approve or escalate issues flagged by the COS or department managers.\n3. Review the monthly payroll run before it's emailed to staff.\n4. Review the weekly policy-acknowledgment gap report and follow up with anyone overdue.\n5. [DRAFT — replace with Shreyas's actual responsibilities.]" },
  { dept: "Supporting Staff", designation: "Security", text: "1. Monitor entry/exit of patients, staff, and visitors\n2. Maintain visitor log (time, purpose, authorization).\n3. Conduct morning & evening security checklists (locks, doors, keys)\n4. Conduct daily checks of clinic infrastructure (AC, lights, lifts, water supply, electricals)." },
  { dept: "Supporting Staff", designation: "House Keeping", text: "1. Clean procedure rooms and washrooms daily before patient comes.\n2. Sanitize procedure beds, chairs, and equipment surfaces after every use.\n3. Empty dustbins/biomedical waste bins regularly and dispose as per protocol.\n4. Refill consumables (toilet rolls, paper towels, sanitizers, handwash).\n5. Ensure cleaning schedules/checklists are completed and signed daily." },
  { dept: "Supporting Staff", designation: "Driver (unfilled position)", text: "1. Ensure timely pick-up and drop of Doctor/Sir as per daily schedule\n2. Keep the car clean, fueled, and ready at all times\n3. Maintain vehicle documents - insurance, RC, pollution certificate\n4. Coordinate with EA/PA for daily movement plans." },
];

// Extracted from the clinic's real, already-in-production Google Apps Script +
// Sheets checklist log (Sept-Oct 2026 submissions) -- these are the clinic's
// actual Opening / During the Day / End of Day items per role, not placeholders.
const SHIFT_CHECKLIST_TEMPLATES = {
  "Housekeeping Coordinator": {
    shift: "Morning",
    sections: [
      { section: "Opening", items: [
        "Mopped floor with disinfectant solution.",
        "Wiped and disinfected reception desk, chairs, and tables.",
        "Cleaned and disinfected sink, toilet, and fixtures.",
        "Ensured hand sanitizers are refilled at all key points.",
        "Wiped mirrors.",
        "Replaced disposable covers (bed sheets).",
        "Replaced used towels/tissue rolls.",
        "Refilled water/refreshment area.",
        "Organized files, reports, and stationery.",
        "Checked and replaced air freshener if needed.",
        "Checked linen and replaced with fresh, washed stock.",
        "Refilled hand wash, sanitizer, tissue paper, and napkins."
      ] },
      { section: "During the Day", items: [
        "Cleaned and disinfected treatment chairs/beds before and after each patient.",
        "Emptied trash bins and replaced liners.",
        "Sanitized treatment beds, trolleys, and stools.",
        "Disinfected medical equipment surfaces.",
        "Ensured medical waste is disposed in biohazard bins.",
        "Removed the used bed sheet/cover from each room and sanitized the room after every patient."
      ] },
      { section: "End of Day", items: [
        "Final floor mopping across all areas.",
        "Double-checked all rooms are disinfected.",
        "Dusted and wiped fans, AC vents, lights, and switchboards.",
        "Cleaned and disinfected sofas, chairs, and tables.",
        "Mopped and disinfected floor.",
        "Wiped glass doors, windows, and partitions.",
        "Emptied and sanitized trash bins.",
        "Cleaned curtains/blinds.",
        "Scrubbed and disinfected toilet seats, sinks, and taps.",
        "Cleaned mirrors, walls, and tiles."
      ] },
    ],
    metrics: [],
  },
  "Pharmacy Coordinator": {
    shift: "Morning",
    sections: [
      { section: "Opening", items: [
        "Deep cleaning: opened the pharmacy, cleaned the racks, and organized the area.",
        "Conducted physical stock audit & submitted report to doctor.",
        "Removed expired medicines and maintained destruction log.",
        "Generated low stock and near-expiry report.",
        "Generated list of new medicines and submitted to doctor.",
        "Co-ordinated with supplier for reorder or replacements.",
        "Informed doctor about new/restocked medicines (with photo in WhatsApp group)."
      ] },
      { section: "During the Day", items: [
        "Checked with the front desk for any last-minute medicine requests.",
        "Ensured no pending bills or patient queries."
      ] },
      { section: "End of Day", items: [
        "Tallied all payments (cash, card, wallet) and ensured totals match billing records.",
        "Counted and organized cash securely in a zip-lock bag.",
        "Handed over the daily financial report to Shreyas sir.",
        "Completed patient analysis of purchase of daily visit.",
        "Turned off computer, printer, lights, and fans.",
        "Ensured devices (card machine, phone) are charging for next day.",
        "Locked the pharmacy securely.",
        "Sent \"Pharmacy closed for the day\" message in the clinic WhatsApp group."
      ] },
    ],
    metrics: [],
  },
  "Procedure Scheduling & Recall Coordinator": {
    shift: "Morning",
    sections: [
      { section: "Opening", items: [
        "Review today's procedures, confirmations, cancellations and likely gaps.",
        "Review newly converted patients awaiting procedure booking.",
        "Review procedure recalls due today.",
        "Prepare the upcoming procedure schedule for Procedure Operations."
      ] },
      { section: "During the Day", items: [
        "Book only from the documented treatment plan and clinical timing.",
        "Confirm procedure appointments and approved pre-visit instructions.",
        "On arrival, verify readiness / financial clearance handoff before Procedure Operations.",
        "Update Procedures Done only after actual completion confirmation.",
        "Create the next session or recall for every completed multi-session treatment."
      ] },
      { section: "End of Day", items: [
        "Reconcile completed procedures against Procedures Done.",
        "Ensure no multi-session completion lacks next-session/recall/course-completed status.",
        "Review overdue recalls and document exceptions.",
        "Report package, documentation or resource conflicts."
      ] },
    ],
    metrics: [],
  },
  "Consultation Scheduling & Recall Coordinator": {
    shift: "Morning",
    sections: [
      { section: "Opening", items: [
        "Review today's consultations, confirmations, waitlist and unconfirmed patients.",
        "Review new enquiries / missed calls and pending callbacks.",
        "Review doctor-advised consultation recalls due today.",
        "Check doctor schedule/capacity changes and released slots."
      ] },
      { section: "During the Day", items: [
        "Respond to new enquiries within the defined response standard.",
        "Book / confirm / reschedule with correct patient, doctor, date and time.",
        "Record cancellations/no-shows with reason and recovery action.",
        "Convert doctor-written future reviews into a booking or dated recall.",
        "Document every recall/contact outcome and next action."
      ] },
      { section: "End of Day", items: [
        "Ensure today's doctor-advised reviews are booked or recalled.",
        "Ensure no unowned consultation recall remains.",
        "Prepare the next-day confirmation queue.",
        "Report overbooking/capacity/patient exceptions to the Front Office Lead."
      ] },
    ],
    metrics: [],
  },
  "Security & Facilities Coordinator": {
    shift: "Morning",
    sections: [
      { section: "Opening", items: [
        "Took keys from building watchman. (remark: Done)",
        "Opened 1st floor shutter and door. (remark: Done)",
        "Switched on all lights. (remark: Done)",
        "Placed keys in holder at front desk. (remark: Done)",
        "Took 3rd floor keys and opened shutter. (remark: Done)",
        "Switched on all 3rd floor lights. (remark: Done)",
        "Arranged water bottles. (remark: Done)",
        "Helped with housekeeping (moved chairs/sofa). (remark: Done)",
        "Checked water level with watchman. (remark: Done)"
      ] },
      { section: "During the Day", items: [
        "Collected phones from staff (10:00 AM). (remark: Done)",
        "Took patient list from front desk. (remark: Done)",
        "Wished patients from lift with a smile.",
        "Verified patient name and opened door.",
        "Gave phones to staff for lunch break.",
        "Collected phones back after 30 min.",
        "Gave phones to staff (final handover)."
      ] },
      { section: "End of Day", items: [
        "Verified all rooms are clean.",
        "Switched off 3rd floor lights, fans, AC.",
        "Locked 3rd floor door & shutter.",
        "Returned 3rd floor keys to holder at front desk.",
        "Checked 1st floor lights, fans, AC.",
        "Locked 1st floor door & shutter.",
        "Helped throw trash with housekeeping.",
        "Returned keys to building watchman.",
        "Informed sir before leaving."
      ] },
    ],
    metrics: [],
  },
  "Reception, Billing & Records Coordinator": {
    shift: "Morning",
    sections: [
      { section: "Opening", items: [
        "Confirm billing system is functional.",
        "Review the Daily Appointment List.",
        "Ensure PSS (Patient Summary Sheet \u2013 Google Sheet) is accessible and updated.",
        "Confirm cash float, if applicable.",
        "Check payment devices.",
        "Ensure patient registration/forms are ready.",
        "Review package / Suggested Treatment sheets needed for the day."
      ] },
      { section: "For Each Arrival", items: [
        "Greet and identify the patient.",
        "Check the Daily Appointment List.",
        "Complete new / existing patient readiness.",
        "Check PSS and relevant previous records.",
        "Verify blood reports in software where applicable; request if not previously submitted.",
        "Check package / session balance where applicable.",
        "Verify complimentary consultation eligibility where applicable.",
        "Complete billing and financial clearance.",
        "Send consultation bill/receipt to the patient.",
        "Hand over to the next responsible team member."
      ] },
      { section: "After Each Consultation", items: [
        "Update the Suggested Treatment Sheet / Pipeline.",
        "Update the Package Sheet, wherever applicable.",
        "Route recommendation to the Counsellor.",
        "Route next-review instruction to the Scheduler.",
        "Ensure billing/payment status is complete."
      ] },
      { section: "End of Day", items: [
        "Verify no completed consultation/procedure is missing billing or payment status.",
        "Verify all consultation bills have been sent to patients.",
        "Verify all Suggested Treatments have been captured.",
        "Verify Package Sheet updates are complete.",
        "Check PSS / Daily Appointment List for pending administrative updates.",
        "Submit collections for independent reconciliation.",
        "Report any billing, package, record or payment discrepancy."
      ] },
    ],
    metrics: [],
  },
  "Patient Counsellor & Treatment Conversion Coordinator": {
    shift: "Morning",
    sections: [
      { section: "A. Opening", items: [
        "Suggested Treatment Sheet/Pipeline is accessible and functioning.",
        "Review previous-day pending recommendations and today's due follow-ups.",
        "Review expected consultation load and likely counselling requirements.",
        "Confirm current approved pricing, packages and active offers.",
        "Check pending escalations / promised callbacks from the previous day.",
        "Confirm Procedure Scheduler / Billing coordination is available for converted patients."
      ] },
      { section: "B. For Every Patient After Consultation", items: [
        "Correct patient and doctor recommendation verified.",
        "Exact treatment recommendation visible in the approved record/sheet.",
        "Clinical session count/interval checked only where documented.",
        "Patient counselled on treatment journey and logistics.",
        "Approved pricing/package/payment options explained.",
        "Clinical questions routed to the doctor where required.",
        "Patient decision/status updated immediately.",
        "Treatment value and meaningful patient response recorded.",
        "If proceeding: handed to Procedure Scheduling / Billing.",
        "If pending: next follow-up date and owner recorded.",
        "If declined/lost: meaningful reason documented."
      ] },
      { section: "C. Follow-Up Queue", items: [
        "All follow-ups due today reviewed.",
        "Calls/WhatsApp follow-ups completed according to approved cadence.",
        "Every contact attempt and outcome documented.",
        "Interested patients moved to booking/scheduling handoff.",
        "Deferred patients given the correct next follow-up date.",
        "Do-not-contact / declined preferences updated appropriately.",
        "Clinical questions generated during follow-up routed to the doctor.",
        "No due follow-up left without a documented reason."
      ] },
      { section: "D. End of Day", items: [
        "All new doctor recommendations reviewed.",
        "No eligible recommendation remains uncounselled without a documented exception.",
        "No Suggested Treatment record remains blank/unassigned.",
        "Every pending recommendation has status + next action + follow-up date.",
        "Every converted patient has been handed to Procedure Scheduling/Billing.",
        "All lost/declined cases have a meaningful reason recorded.",
        "All clinical/pricing/patient-experience exceptions escalated.",
        "Tomorrow's due follow-up queue reviewed.",
        "Daily numbers/conversion summary submitted as required."
      ] },
    ],
    metrics: ["New Recommendations Received", "Patients Counselled", "Treatments Booked / Converted", "Suggested Value", "Booked Value", "Follow-Ups Due", "Follow-Ups Completed", "Deferred / Considering", "Declined / Lost", "Open Escalations"],
  },
  "Photography / Documentation Coordinator": {
    shift: "Morning",
    sections: [
      { section: "Opening", items: [
        "Review today's appointment list for patients requiring photography.",
        "Confirm the approved photography device/storage is ready.",
        "Retrieve relevant prior images for expected returning patients.",
        "Check pending upload/tagging issues from the previous day."
      ] },
      { section: "During the Day", items: [
        "Confirm patient identity before photography.",
        "Follow required views/angles/lighting/background protocol.",
        "Upload to the correct patient record with correct date/visit tagging.",
        "Confirm prior/current images are retrievable before clinical handoff.",
        "Correct/flag poor-quality, missing or mis-tagged images immediately."
      ] },
      { section: "End of Day", items: [
        "Confirm all eligible patients have required images or a documented exception.",
        "Check no pending upload or incorrect tagging remains unexplained.",
        "Confirm no clinical image remains on unapproved device/storage.",
        "Escalate privacy/device/record issues."
      ] },
    ],
    metrics: [],
  },
  "Patient Flow Coordinator": {
    shift: "Morning",
    sections: [
      { section: "Opening", items: [
        "Review doctor schedules, expected patient load and sensitive/priority cases.",
        "Open / check the live patient-flow board.",
        "Identify readiness dependencies and likely bottlenecks.",
        "Coordinate opening readiness with Reception / Photography / clinical teams."
      ] },
      { section: "During the Day", items: [
        "Maintain a current status and owner for every patient in clinic.",
        "Verify prerequisites before Associate/Junior Doctor handoff.",
        "Ensure a patient is marked Ready for the Doctor only after clinical prerequisites are met.",
        "Keep the next appropriate patient ready and minimise avoidable doctor idle time.",
        "Communicate delays beyond threshold and route the patient explicitly after consultation."
      ] },
      { section: "End of Day", items: [
        "Ensure no patient remains on the live board without a valid status.",
        "Confirm all in-clinic patients were handed to the next function or exited.",
        "Record/escalate waiting, readiness and flow exceptions.",
        "Close / update the live board for the day."
      ] },
    ],
    metrics: [],
  },
  "3rd Floor \u2014 Procedure & Stock Controller": {
    shift: "Morning",
    sections: [
      { section: "Opening", items: [
        "Mark Pagar Attendance \u2013 Morning.",
        "Post the required morning update/text in the group.",
        "Water the plants on the 3rd floor.",
        "Check all procedure rooms and common areas for cleanliness.",
        "If cleaning is required, inform Housekeeping immediately.",
        "Collect the Stock Room Key from Pharmacy.",
        "Review the day's procedure list and check the total patient/procedure count.",
        "Check procedure-wise stock and consumable requirements for the day.",
        "Check availability of MNRF, HydraFacial and GFC consumables/materials.",
        "Collect required tips/consumables from the 1st floor.",
        "Ensure drinking water is available in Sir's Room."
      ] },
      { section: "During the Day", items: [
        "Ensure all required consumables, tips and materials are ready before each procedure.",
        "Check the procedure rooms every 1 hour for cleanliness, stock and readiness.",
        "After completion of every procedure, inform Housekeeping to clean and reset the room.",
        "Recheck the room after cleaning and ensure it is ready for the next patient.",
        "Refill frequently used consumables whenever required.",
        "Track procedure consumables used and update stock usage.",
        "Report any low-stock / out-of-stock items immediately.",
        "Ensure equipment, tips and consumables are returned to their designated places after use.",
        "Complete the washroom checklist and take photos as proof of cleaning.",
        "Collect the PSS (Patient Summary Sheet) form and submit it at the front desk.",
        "Collect tips after every procedure."
      ] },
      { section: "End of Day", items: [
        "Check tomorrow's procedure list before closing.",
        "Identify the tips/consumables required for tomorrow's procedures.",
        "Collect the required procedure tips from the 1st floor and keep them ready in the Photo Room.",
        "Arrange and verify all tips according to tomorrow's procedures.",
        "Take a photo of the tips/materials prepared for tomorrow.",
        "Post the photo in the designated group as proof of next-day procedure preparation.",
        "Check remaining procedure stock and note items requiring replenishment.",
        "Check all procedure rooms before leaving.",
        "Ensure all windows on the floor are properly closed.",
        "Lock the Stock Room properly.",
        "Hand over the Stock Room Key to Pharmacy.",
        "Share any pending stock shortage/issues in the group.",
        "Mark Pagar Attendance \u2013 End of Day."
      ] },
    ],
    metrics: [],
  },
  "Accounts Executive": {
    shift: "Evening",
    sections: [
      { section: "Opening", items: [
        "Mark Pagar attendance \u2013 Morning immediately after reaching the clinic.",
        "Post the Good Morning message in the group.",
        "Check bank balances and previous-day transactions.",
        "Check previous-day clinic & pharmacy sales entries.",
        "Check pending payment/collection follow-ups.",
        "Check any pending accounts tasks from the previous day.",
        "Review payments due for the day.",
        "Check emails/messages for any accounts-related requirements."
      ] },
      { section: "End of Day", items: [
        "Enter/update daily Clinic & Pharmacy sales in Tally.",
        "Update petty cash expenses with vouchers/bills.",
        "Update stock purchases/inward entries, if any.",
        "Verify daily collections against billing/payment modes.",
        "Check and update pending receivables/payables.",
        "File/organise the day's bills, vouchers and supporting documents.",
        "Update the accounts task tracker.",
        "Post the required Good Evening message before leaving.",
        "Mark Pagar attendance \u2013 Evening before leaving the clinic."
      ] },
      { section: "Weekly", items: [
        "Reconcile physical purchase invoices with software/register.",
        "Check weekly Vendor & Payment ageing.",
        "Match closing stock of Pharmacy & Clinic with Tally.",
        "Calculate grooming fines, if applicable.",
        "Check Pagar attendance for the week.",
        "Review petty cash expenses and supporting vouchers.",
        "Review outstanding receivables and follow up on pending collections.",
        "Review outstanding vendor payments.",
        "Check bank entries and identify unreconciled transactions.",
        "Check that all sales/purchase entries for the week are completed."
      ] },
      { section: "Monthly", items: [
        "Complete Salary Calculations.",
        "Prepare Bank & Credit Card Statements/Entries.",
        "Finalize Tally for the previous month.",
        "Prepare Financials for the previous month.",
        "Send Tally data & relevant documents.",
        "Write/send Vendor Cheques (45 days) as applicable.",
        "Prepare and pay TDS/TCS.",
        "Complete Professional Tax (PT) payment.",
        "Prepare GSTR-1 / Outward Supplies and coordinate with CA team.",
        "Pay Advance Tax, when applicable.",
        "Complete GSTR-3B filing/coordination with CA team.",
        "Collect TDS quarterly return documents, when applicable.",
        "Issue/collect TDS certificates, when applicable.",
        "Reconcile Trade Payables with Tally and software.",
        "Review Credit Card Payment Reminders \u2013 Axis & HDFC.",
        "Complete month-end Bank Reconciliation.",
        "Review Debtors & Creditors ageing.",
        "Ensure all bills, invoices and supporting documents are filed for the month."
      ] },
    ],
    metrics: [],
  },
  "HR Executive": {
    shift: "Evening",
    sections: [
      { section: "Morning Routine (Before 11:00 AM)", items: [
        "Check attendance.",
        "Post the attendance update in the clinic group.",
        "Conduct the morning grooming and uniform check.",
        "Post the morning grooming picture/update in the group.",
        "Every Monday, conduct a deep grooming check, including nails, hair, uniform and footwear.",
        "Send important morning reminders.",
        "Check leave letters and pending leave approvals.",
        "Conduct the team huddle (days to be confirmed) and phone submission.",
        "Ensure all morning HR activities are completed before 11:00 AM."
      ] },
      { section: "Afternoon (2:30 PM \u2013 3:00 PM)", items: [
        "Conduct the afternoon grooming check.",
        "Check uniform and overall grooming.",
        "Check phone submission.",
        "Update the grooming register and post the required update in the group."
      ] },
      { section: "Daily HR & Staff Coordination", items: [
        "Follow up on attendance, leave and employee-related concerns.",
        "Maintain leave letters and approval records.",
        "Coordinate new employee joining and onboarding requirements.",
        "Follow up on uniforms, grooming and other staff requirements.",
        "Communicate important HR updates to the concerned management."
      ] },
      { section: "Recruitment & Interview Coordination", items: [
        "Check candidate responses and follow up with candidates.",
        "Schedule L-1 and L-2 interviews based on management availability.",
        "Coordinate interview timings with candidates.",
        "Update the interview calendar and recruitment tracker.",
        "Maintain candidate status: scheduled, completed, selected, rejected or pending.",
        "Follow up on pending interview decisions.",
        "Coordinate joining dates of selected candidates.",
        "Follow up on pending offer letters and employee documentation."
      ] },
      { section: "End of Day", items: [
        "Review final attendance, leave and staff updates.",
        "Update the recruitment and interview tracker.",
        "Record joining/onboarding updates.",
        "Prepare and send the daily EOD report.",
        "Mention important updates, issues and pending tasks.",
        "Note the follow-ups required for the next working day."
      ] },
      { section: "Weekly Review (Saturdays)", items: [
        "Review weekly attendance and leave records in PagarBook.",
        "Review grooming compliance for the week.",
        "Review the recruitment pipeline and pending interviews.",
        "Review new joiners and onboarding status.",
        "Review pending offer letters and HR tasks.",
        "Prepare priorities and follow-ups for the coming week."
      ] },
    ],
    metrics: [],
  },
  "Evening Housekeeping": {
    shift: "Evening",
    sections: [
      { section: "End of Day", items: [
        "Check and clean all procedure rooms.",
        "Clean the procedure room after every procedure.",
        "Clean procedure beds, tables and surfaces.",
        "Empty all dustbins and replace covers.",
        "Clean the Photo Room.",
        "Clean Sir's and Ma'am's Room.",
        "Clean the waiting/reception area.",
        "Clean the washrooms.",
        "Sweep and mop the complete floor.",
        "Refill tissues, handwash and other required items.",
        "After the last procedure, do the final cleaning of all rooms.",
        "Arrange all housekeeping materials properly.",
        "Handover Ma'am's and Sir's bags to Security before leaving.",
        "Take photos of the completed cleaning work.",
        "Post the photos in the group at the end of the day."
      ] },
    ],
    metrics: [],
  },
  "Weekly Deep Cleaning": {
    shift: "Morning",
    sections: [
      { section: "1st Floor", items: [
        "Trolleys deep cleaning.",
        "Autoclave cleaning/check.",
        "All rooms & beds deep cleaning.",
        "Photo Room & Doctor Room deep cleaning.",
        "Stock counting.",
        "All machines deep cleaning. (remark: No machines )",
        "Chairs cleaning.",
        "Training.",
        "Consent forms setting.",
        "Post-care cards setting.",
        "Fridges cleaning.",
        "Consent forms completion/check.",
        "Godown cleaning.",
        "Lift deep cleaning.",
        "Restroom deep cleaning.",
        "Samples & expiry stock checking.",
        "Pantry deep cleaning.",
        "Front Desk cleaning."
      ] },
      { section: "3rd Floor", items: [
        "Trolleys deep cleaning.",
        "All rooms deep cleaning.",
        "Beds deep cleaning.",
        "Stock counting.",
        "Chairs cleaning.",
        "All machines deep cleaning.",
        "Consent forms setting.",
        "Post-care cards setting.",
        "All room cupboards setting/organising.",
        "Both restrooms deep cleaning.",
        "Lunch area deep cleaning.",
        "Locker room deep cleaning.",
        "Outdoor/balcony area washing & mopping.",
        "Ladder cleaning.",
        "Lift room cleaning.",
        "Stock room deep cleaning.",
        "Sir's Room deep cleaning.",
        "Doctor's Room deep cleaning.",
        "NARF tip check/cleaning \u2013 1st Wednesday of every month.",
        "Doctor's Query Recap."
      ] },
    ],
    metrics: [],
  },
};

const DEFAULT_PIN = "1234";

// ---------------------------------------------------------------------------
// Three legal entities sharing one staff app. Only Shanta's Derma Pharmacy's
// address is known (from a real payslip you shared) -- the other two are
// placeholders for you to fill in via PATCH or the admin Companies screen.
// Every staff member defaults to Dr. Nishita's Clinic unless reassigned;
// Neelima is set to Shanta's Derma Pharmacy since that's where her real
// payslip came from.
// ---------------------------------------------------------------------------
const COMPANIES = [
  { name: "Dr. Nishita's Clinic", address: null },
  { name: "Dr. Nishita Skin Hair & Aesthetics", address: null },
  { name: "Shanta's Derma Pharmacy", address: "Road No.7, 1st floor, Sowbhagya Abode, Beside Iran Embassy, Banjarahills, Hyderabad, Telangana - 500034" },
];

// ---------------------------------------------------------------------------
// STARTER POLICY DRAFTS -- these are reasonable defaults for a small clinic,
// NOT your actual finalized policies. The Policies page on your Google Site
// was empty, so there was nothing to migrate; these exist so the module has
// real content to look at rather than an empty screen, and so you have
// something concrete to edit rather than a blank page to write from scratch.
// Edit every one of these (via the admin Policies screen, or directly here)
// before treating them as your clinic's actual policy.
// ---------------------------------------------------------------------------
const STARTER_POLICIES = [
  {
    title: "Attendance & Punctuality Policy",
    category: "HR",
    body: `Purpose: To ensure the clinic runs smoothly and patients are seen on time.

1. Staff are expected to check in by their scheduled shift start time using the app's biometric attendance feature.
2. Arriving more than 15 minutes late without prior notice to your manager is considered a late arrival.
3. Three or more late arrivals in a calendar month will be discussed with your manager.
4. If you are unable to attend a shift, notify your manager as early as possible, and at minimum 2 hours before shift start where the situation allows.
5. Attendance records are visible to admin and your manager; you can view your own history in the app at any time.

[Sensible default — confirm the 15-minute, 2-hour, and 3-occurrence thresholds match how you actually want this enforced, then remove this line.]`,
  },
  {
    title: "Leave Policy",
    category: "HR",
    body: `Purpose: To set clear, fair expectations for time off.

1. Staff are entitled to 12 days of paid casual/sick leave per year, accrued at 1 day per month.
2. Leave requests should be submitted through the app at least 3 days in advance where possible; same-day sick leave should be reported to your manager as early as possible.
3. Emergency leave without advance notice will not be penalized, but should be followed up with your manager within 24 hours of returning.
4. Unused leave does not carry over to the next year and is not paid out on exit, unless your employment contract states otherwise.
5. Your manager approves leave requests; if declined, a reason will be given.

[Sensible default — 12 days/year is a common baseline for a small clinic in India, but confirm this matches what you actually offer (and any statutory minimum that applies in your state) before treating it as final, then remove this line.]`,
  },
  {
    title: "Code of Conduct",
    category: "Conduct",
    body: `Purpose: To maintain a respectful, professional, and safe environment for staff and patients.

1. Treat all patients, visitors, and colleagues with courtesy and respect, regardless of role or seniority.
2. Maintain patient confidentiality at all times -- do not discuss patient information outside of clinical need, including with other staff not involved in that patient's care.
3. Report any safety concern, equipment issue, or patient complaint to your manager or admin promptly.
4. Personal phone use should not interfere with patient care duties during shift hours.
5. Any harassment, discrimination, or bullying will not be tolerated and should be reported to admin immediately -- your report will be handled confidentially.`,
  },
  {
    title: "Patient Confidentiality & Data Handling",
    category: "Clinical",
    body: `Purpose: To protect patient privacy and comply with applicable health information regulations.

1. Patient records, photos, and medical history may only be accessed by staff whose role requires it for that patient's care.
2. Never share patient information, photos, or records outside the clinic's approved systems (e.g. personal WhatsApp, personal phone storage).
3. Before/after treatment photos must be stored only in the clinic's approved software, tagged correctly, and never shared without patient consent.
4. If a data handling mistake occurs (e.g. a photo sent to the wrong person), report it to admin immediately rather than trying to quietly fix it -- early reporting limits harm.

[This reflects reasonable operational practice; it hasn't been reviewed against the specific health-data regulations in your jurisdiction — a one-time legal review is worth doing before treating this as fully compliant, then remove this line.]`,
  },
  {
    title: "Grievance & Escalation Process",
    category: "HR",
    body: `Purpose: To give every staff member a clear, safe path to raise a concern.

1. For day-to-day issues, speak with your direct manager first.
2. If the concern involves your manager, or you're not comfortable raising it with them, escalate directly to admin (Dr. Nishita).
3. All grievances will be acknowledged within 2 working days and a resolution or next step communicated within 7 working days.
4. Raising a genuine concern in good faith will never be held against you.`,
  },
];

function upsertLookup(table, id, name) {
  db.prepare(`INSERT OR IGNORE INTO ${table} (id, name) VALUES (?, ?)`).run(id, name);
  return db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name).id;
}

// --- departments & roles ---
const deptIds = {};
for (const d of DEPARTMENTS) deptIds[d] = upsertLookup("departments", randomUUID(), d);

const roleIds = {};
for (const r of ROLES) roleIds[r] = upsertLookup("roles", randomUUID(), r);

// --- permissions ---
const permIds = {};
for (const action of PERMISSIONS) {
  db.prepare("INSERT OR IGNORE INTO permissions (id, action) VALUES (?, ?)").run(randomUUID(), action);
  permIds[action] = db.prepare("SELECT id FROM permissions WHERE action = ?").get(action).id;
}

// --- role_permissions ---
const insertRolePerm = db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)");
for (const [role, actions] of Object.entries(ROLE_PERMISSIONS)) {
  for (const action of actions) insertRolePerm.run(roleIds[role], permIds[action]);
}

// --- companies ---
const companyIds = {};
for (const c of COMPANIES) {
  db.prepare("INSERT OR IGNORE INTO companies (id, name, address) VALUES (?, ?, ?)").run(randomUUID(), c.name, c.address);
  companyIds[c.name] = db.prepare("SELECT id FROM companies WHERE name = ?").get(c.name).id;
}

// --- users ---
const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (id, name, phone, email, password_hash, pin_hash, role_id, department_id, designation)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
for (const u of USERS) {
  const passwordHash = u.password ? bcrypt.hashSync(u.password, 10) : null;
  const pinHash = u.role !== "admin" ? bcrypt.hashSync(DEFAULT_PIN, 10) : null;
  insertUser.run(randomUUID(), u.name, u.phone, u.email || null, passwordHash, pinHash, roleIds[u.role], deptIds[u.dept], u.designation || null);
}
// Fix designation for anyone seeded before this column existed (same
// idempotent-by-name pattern as the Management department fix above).
for (const u of USERS) {
  if (u.designation) db.prepare("UPDATE users SET designation = ? WHERE name = ? AND designation IS NULL").run(u.designation, u.name);
}

// Group clinic leadership under "Management" even if this database was
// already seeded once before this change — an UPDATE by name, not an INSERT,
// so it fixes existing rows too instead of only applying to a fresh seed.
for (const name of ["Dr. Nishita (Admin)", "Shreyas Bagamar", "Naga", "Neelima"]) {
  db.prepare("UPDATE users SET department_id = ? WHERE name = ?").run(deptIds["Management"], name);
}

// Neelima's real join date, from her actual payslip (22 Oct 2025).
db.prepare("UPDATE users SET joined_at = ? WHERE name = ?").run("2025-10-22", "Neelima");

// --- Management & Team profiles (the "About" page's Management section) ---
// The source site's Management page was empty, so this used to start empty
// too. Now that you've named the actual leadership group, it's seeded for
// real: Dr. Nishita, Shreyas Bagamar, Naga (COS), and Neelima (MIS).
const TEAM_PROFILES = [
  { name: "Dr. Nishita Ranka", title: "Founder & Medical Director", bio: "Founder and Medical Director of Dr. Nishita's Clinic.", sort: 1 },
  { name: "Shreyas Bagamar", title: "Director (confirm exact title)", bio: "DRAFT — add a short bio once confirmed; this placeholder exists so the profile isn't blank.", sort: 2 },
  { name: "Naga", title: "Chief of Staff (COS)", bio: "Oversees daily operations across all departments, SOP compliance, and HR functions.", sort: 3 },
  { name: "Neelima", title: "MIS Executive", bio: "Designs and maintains management dashboards and consolidates reports across departments.", sort: 4 },
];
for (const t of TEAM_PROFILES) {
  const exists = db.prepare("SELECT id FROM team_profiles WHERE name = ?").get(t.name);
  if (!exists) {
    db.prepare("INSERT INTO team_profiles (id, name, title, bio, sort_order) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), t.name, t.title, t.bio, t.sort);
  }
}

// Neelima's real recurring pay profile, matching her June 2026 payslip exactly
// (Basic 20,000; Retention 2,000 deduction; everything else nil that month).
// This is the ONLY real pay profile seeded — every other employee needs their
// actual salary structure entered via the admin Payroll screen before payroll
// can run for them; nothing is fabricated for anyone else.
const neelima = db.prepare("SELECT id FROM users WHERE name = ?").get("Neelima");
if (neelima) {
  db.prepare(
    `INSERT OR REPLACE INTO pay_profiles (user_id, company_id, employee_code, position, pan, basic_salary, leave_bonus, overtime, other_allowances, pf, tds, other_deductions, retention)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(neelima.id, companyIds["Shanta's Derma Pharmacy"], "NC2025MIS02", "MIS Executive", "RYPPS1985A", 20000, 0, 0, 0, 0, 0, 0, 2000);
}

// --- checklist templates, split into individual line items ---
const insertTemplate = db.prepare(
  "INSERT INTO checklist_templates (id, category, title, default_notes) VALUES (?, ?, ?, ?)"
);
let templateCount = 0;
for (const src of TEMPLATE_SOURCE) {
  const lines = src.text
    .split("\n")
    .map((l) => l.replace(/^\s*\d+[\.\)]\s*/, "").trim())
    .filter(Boolean);
  for (const line of lines) {
    insertTemplate.run(randomUUID(), src.dept, line, `From: ${src.designation}`);
    templateCount++;
  }
}

// --- starter policy drafts ---
const insertPolicy = db.prepare(
  "INSERT INTO policies (id, title, category, body, version) VALUES (?, ?, ?, ?, 1)"
);
let policyCount = 0;
for (const p of STARTER_POLICIES) {
  const exists = db.prepare("SELECT id FROM policies WHERE title = ?").get(p.title);
  if (!exists) {
    insertPolicy.run(randomUUID(), p.title, p.category, p.body);
    policyCount++;
  }
}

// --- shift checklists: real per-role templates ported from the Apps Script system ---
// Idempotent: clear and re-insert each role's rows every run so edits to
// SHIFT_CHECKLIST_TEMPLATES above always take effect, instead of only applying
// to a brand-new database.
const delTemplateRows = db.prepare("DELETE FROM shift_checklist_templates WHERE role_name = ?");
const insertTemplateRow = db.prepare(
  "INSERT INTO shift_checklist_templates (id, role_name, shift, section, item_text, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
);
const delMetricRows = db.prepare("DELETE FROM shift_checklist_metric_fields WHERE role_name = ?");
const insertMetricRow = db.prepare(
  "INSERT INTO shift_checklist_metric_fields (id, role_name, field_name, sort_order) VALUES (?, ?, ?, ?)"
);
let shiftChecklistItemCount = 0;
for (const [roleName, tpl] of Object.entries(SHIFT_CHECKLIST_TEMPLATES)) {
  delTemplateRows.run(roleName);
  let sort = 0;
  for (const section of tpl.sections) {
    for (const item of section.items) {
      insertTemplateRow.run(randomUUID(), roleName, tpl.shift, section.section, item, sort++);
      shiftChecklistItemCount++;
    }
  }
  delMetricRows.run(roleName);
  (tpl.metrics || []).forEach((field, i) => insertMetricRow.run(randomUUID(), roleName, field, i));
}

// Assign each user their real shift-checklist role (idempotent UPDATE by name,
// same pattern as the designation/department fixes above).
for (const [name, roleName] of Object.entries(USER_SHIFT_ROLE)) {
  db.prepare("UPDATE users SET shift_role = ? WHERE name = ?").run(roleName, name);
}

console.log(`Seeded ${DEPARTMENTS.length} departments, ${ROLES.length} roles, ${PERMISSIONS.length} permissions.`);
console.log(`Seeded ${USERS.length} real staff users (default PIN: ${DEFAULT_PIN}; admin uses ADMIN_EMAIL/ADMIN_PASSWORD).`);
console.log(`Seeded ${templateCount} checklist templates across ${TEMPLATE_SOURCE.length} roles.`);
console.log(`Seeded ${policyCount} STARTER policy drafts — these are placeholders for you to review and edit, not final policy.`);
console.log(`Seeded ${COMPANIES.length} companies. Only Shanta's Derma Pharmacy has a real address on file.`);
console.log(`Seeded 1 real pay profile (Neelima, from her actual June 2026 payslip). Every other employee needs a pay profile added via the admin Payroll screen before payroll can run for them.`);
console.log(`REMINDER: phone numbers are placeholders (+9190000200xx) — replace with real WhatsApp numbers before going live.`);
console.log(`Management group: Dr. Nishita, Shreyas Bagamar, Naga (COS), Neelima (MIS) — all under the "Management" department, with profiles on the About page. Shreyas's exact title, real contact details, and checklist are still DRAFT placeholders — confirm and update via the Staff screen.`);
console.log(`Seeded ${shiftChecklistItemCount} real shift-checklist items across ${Object.keys(SHIFT_CHECKLIST_TEMPLATES).length} roles, ported from the clinic's live Apps Script + Sheets checklist log. ${Object.keys(USER_SHIFT_ROLE).length} staff were matched to their real role; "Weekly Deep Cleaning" has no assigned person yet (it was a shared/rotating checklist in the old system — assign it to someone from Staff if you want it active).`);
console.log(`Added 4 real staff found only in the checklist log but missing from the roster: Geetha, Ayesha, Aboli, Sivamma — their phone numbers and departments are placeholders, confirm via Staff.`);
