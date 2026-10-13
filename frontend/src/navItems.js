// Navigation model. Keys (left) are stable internal view ids used across the app;
// `label` is what people see. Groups define the sidebar sections, in order.
export const NAV = {
  "Dashboard":        { label: "Overview",            icon: "home" },
  "My checklist":     { label: "My Tasks",            icon: "list" },
  "Shift Checklist":  { label: "My Shift Checklist",  icon: "clipboard" },
  "Tracker":          { label: "My Progress",         icon: "tasks" },
  "Attendance":       { label: "Attendance",          icon: "clock" },
  "Shift Logs":       { label: "Checklist Monitor",   icon: "calendarCheck" },
  "Roster":           { label: "Shift Roster",        icon: "calendarCheck" },
  "Departments":      { label: "Departments",         icon: "users" },
  "Exits":            { label: "Staff Exits",         icon: "userplus" },
  "Staff":            { label: "Staff",               icon: "users" },
  "My Profile":       { label: "My Profile",          icon: "user" },
  "Payroll":          { label: "Payroll",             icon: "wallet" },
  "HR":               { label: "Offer Letters",       icon: "file" },
  "Reports":          { label: "Reports",             icon: "chart" },
  "Dashboards":       { label: "Clinic Dashboards",   icon: "chart" },
  "Documents":        { label: "Documents",           icon: "file" },
  "Policies":         { label: "Policies & SOPs",     icon: "shield" },
  "Learning":         { label: "Training Library",    icon: "cap" },
  "Events":           { label: "Events & Culture",    icon: "party" },
  "Clinic Assistant": { label: "Clinic Assistant",    icon: "bot" },
  "Assistant":        { label: "Help Assistant",      icon: "bot" },
  "AI Advisors":      { label: "AI Advisors",         icon: "sparkles" },
  "System":           { label: "System & Backups",    icon: "shield" },
  "Onboarding":       { label: "Staff Onboarding",    icon: "userplus" }, // opened from the Staff page, not the menu
};

// One place for each job. Admin sees: Home / People / Insights / Knowledge / Assistants / Admin.
export const NAV_GROUPS = [
  { title: "Home",         keys: ["Dashboard", "My checklist"] },
  { title: "Daily work",   keys: ["Shift Checklist", "Tracker", "Attendance", "Roster", "Shift Logs"] },
  { title: "People & pay", keys: ["Departments", "Staff", "Exits", "My Profile", "Payroll", "HR"] },
  { title: "Insights",     keys: ["Reports", "Dashboards"] },
  { title: "Knowledge",    keys: ["Documents", "Policies", "Learning", "Events"] },
  { title: "Assistants",   keys: ["Clinic Assistant", "Assistant", "AI Advisors"] },
  { title: "Administration", keys: ["System"] },
];

export function navItemsFor(user) {
  const common = ["Documents", "Policies", "Learning", "Events", "Clinic Assistant", "Assistant"];
  if (user.role === "admin") return ["Dashboard", "Attendance", "Roster", "Shift Logs", "Departments", "Staff", "Exits", "Payroll", "HR", "Reports", "Dashboards", ...common, "AI Advisors", "System"];
  if (user.role === "manager") return ["Dashboard", "Shift Checklist", "Attendance", "Roster", "Shift Logs", "Departments", "Reports", "Dashboards", ...common, "AI Advisors"];
  return ["My checklist", "Shift Checklist", "Tracker", "My Profile", ...common.filter((k) => k !== "Events")];
}
