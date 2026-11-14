// Navigation model. Keys (left) are stable internal view ids used across the app;
// `label` is what people see. Groups define the sidebar sections, in order.
export const NAV = {
  "Dashboard":        { label: "Overview",            icon: "home" },
  "My checklist":     { label: "My Tasks",            icon: "list" },
  "Shift Checklist":  { label: "My Shift Checklist",  icon: "clipboard" },
  "Tracker":          { label: "My Progress",         icon: "tasks" },
  "Attendance":       { label: "Attendance",          icon: "clock" },
  "Procedure Rooms":  { label: "Procedure Rooms",     icon: "clipboard" },
  "Departments":      { label: "Departmental Workspaces", icon: "users" },
  "My Workspace":     { label: "My Workspace",        icon: "file" },
  "Exits":            { label: "Offboarding (Staff Exit)",  icon: "userplus" },
  "Staff":            { label: "Staff Profiles",      icon: "users" },
  "My Profile":       { label: "My Profile",          icon: "user" },
  "Leave":            { label: "Leave & HR",          icon: "calendarCheck" },
  "Payroll":          { label: "Payroll",             icon: "wallet" },
  "HR":               { label: "Offer Letters",       icon: "file" },
  "Reports":          { label: "Reports",             icon: "chart" },
  "Dashboards":       { label: "Dashboards",          icon: "chart" },
  "Documents":        { label: "Documents",           icon: "file" },
  "Policies":         { label: "Policies",            icon: "shield" },
  "SOPs":             { label: "SOPs",                icon: "clipboard" },
  "Learning":         { label: "Training Library",    icon: "cap" },
  "Events":           { label: "Events & Culture",    icon: "party" },
  "Auto Messages":    { label: "Auto Messages",       icon: "sparkles" },
  "Clinic Assistant": { label: "Lumi — Clinic Assistant", icon: "bot" },
  "Assistant":        { label: "Ask Work Hub",        icon: "sparkles" },
  "System":           { label: "System & Backups",    icon: "shield" },
  "Onboarding":       { label: "Onboarding (New Staff)",    icon: "userplus" },
};

// One place for each job. Admin sees: Home / People / Insights / Knowledge / Assistants / Admin.
export const NAV_GROUPS = [
  { title: "Home",            keys: ["Dashboard", "My checklist"] },
  { title: "Daily Work",      keys: ["Shift Checklist", "Tracker", "Attendance", "Procedure Rooms"] },
  { title: "Workspaces",      keys: ["Departments", "My Workspace"] },
  { title: "HR",              keys: ["Staff", "Onboarding", "HR", "Leave", "Payroll", "Exits", "My Profile"] },
  { title: "Insights",        keys: ["Reports", "Dashboards"] },
  { title: "Knowledge",       keys: ["Documents", "Policies", "SOPs", "Learning", "Events", "Auto Messages"] },
  { title: "Assistants",      keys: ["Clinic Assistant", "Assistant"] },
  { title: "Administration",  keys: ["System"] },
];

export function navItemsFor(user) {
  // Insights, Knowledge and the Clinic Chatbot are for the leadership team only (admin + people the admin ticks: MIS, COS, COE, doctors).
  const lead = user.role === "admin" || !!user.leadership;
  if (user.role === "admin") return ["Dashboard", "Attendance", "Procedure Rooms", "Dashboards", "Departments", "Staff", "Onboarding", "HR", "Leave", "Payroll", "Exits", "Documents", "Policies", "SOPs", "Learning", "Events", "Auto Messages", "Clinic Assistant", "Assistant", "System"];
  if (user.role === "manager") return ["Dashboard", "Shift Checklist", "Procedure Rooms", ...(user.isHr ? ["Attendance", "Staff", "Onboarding", "HR", "Payroll", "Exits", "Events", "Auto Messages"] : []), "Dashboards", "Departments", "Leave", ...(lead ? ["Reports", "Documents", "Policies", "SOPs", "Learning", ...(user.isHr ? [] : ["Events"]), "Clinic Assistant"] : []), "Assistant"];
  return ["My checklist", "Shift Checklist", ...(user.roomsAccess ? ["Procedure Rooms"] : []), "Tracker", "My Workspace", "My Profile", "Leave", ...(lead ? ["Dashboards", "Reports", "Documents", "Policies", "SOPs", "Learning", "Events", "Clinic Assistant"] : []), "Assistant"];
}
