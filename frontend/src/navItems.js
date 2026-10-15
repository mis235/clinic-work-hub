// Navigation model. Keys (left) are stable internal view ids used across the app;
// `label` is what people see. Groups define the sidebar sections, in order.
export const NAV = {
  "Dashboard":        { label: "Overview",            icon: "home" },
  "My checklist":     { label: "My Tasks",            icon: "list" },
  "Shift Checklist":  { label: "My Shift Checklist",  icon: "clipboard" },
  "Tracker":          { label: "My Progress",         icon: "tasks" },
  "Attendance":       { label: "Attendance",          icon: "clock" },
  "Shift Logs":       { label: "Checklist Monitor",   icon: "calendarCheck" },
  "Departments":      { label: "Departments & Workspaces", icon: "users" },
  "My Workspace":     { label: "My Workspace",        icon: "file" },
  "Exits":            { label: "Staff Exits",         icon: "userplus" },
  "Staff":            { label: "Staff",               icon: "users" },
  "My Profile":       { label: "My Profile",          icon: "user" },
  "Leave":            { label: "Leave & HR",          icon: "calendarCheck" },
  "Payroll":          { label: "Payroll",             icon: "wallet" },
  "HR":               { label: "Offer Letters",       icon: "file" },
  "Reports":          { label: "Reports",             icon: "chart" },
  "Dashboards":       { label: "Dashboards",   icon: "chart" },
  "Documents":        { label: "Documents",           icon: "file" },
  "Policies":         { label: "Policies & SOPs",     icon: "shield" },
  "Learning":         { label: "Training Library",    icon: "cap" },
  "Events":           { label: "Events & Culture",    icon: "party" },
  "Clinic Assistant": { label: "Clinic Chatbot",      icon: "bot" },
  "Assistant":        { label: "Ask Work Hub",        icon: "sparkles" },
  "System":           { label: "System & Backups",    icon: "shield" },
  "Onboarding":       { label: "Staff Onboarding",    icon: "userplus" }, // opened from the Staff page, not the menu
};

// One place for each job. Admin sees: Home / People / Insights / Knowledge / Assistants / Admin.
export const NAV_GROUPS = [
  { title: "Home",         keys: ["Dashboard", "My checklist"] },
  { title: "Daily work",   keys: ["Shift Checklist", "Tracker", "Attendance", "Shift Logs"] },
  { title: "People & pay", keys: ["Departments", "Staff", "Exits", "My Profile", "Leave", "Payroll", "HR"] },
  { title: "Insights",     keys: ["Reports", "Dashboards"] },
  { title: "Knowledge",    keys: ["Documents", "Policies", "Learning", "Events"] },
  { title: "Assistants",   keys: ["Clinic Assistant", "Assistant"] },
  { title: "Administration", keys: ["System"] },
];

export function navItemsFor(user) {
  // Insights, Knowledge and the Clinic Chatbot are for the leadership team only (admin + people the admin ticks: MIS, COS, COE, doctors).
  const lead = user.role === "admin" || !!user.leadership;
  if (user.role === "admin") return ["Dashboard", "Attendance", "Shift Logs", "Departments", "Staff", "Exits", "Leave", "Payroll", "HR", "Reports", "Dashboards", "Documents", "Policies", "Learning", "Events", "Clinic Assistant", "Assistant", "System"];
  if (user.role === "manager") return ["Dashboard", "Shift Checklist", "Attendance", "Shift Logs", "Departments", "Leave", ...(lead ? ["Reports", "Dashboards", "Documents", "Policies", "Learning", "Events", "Clinic Assistant"] : []), "Assistant"];
  return ["My checklist", "Shift Checklist", "Tracker", "My Workspace", "My Profile", "Leave", ...(lead ? ["Documents", "Policies", "Learning", "Clinic Assistant"] : []), "Assistant"];
}
