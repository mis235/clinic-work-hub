// Navigation model. Keys (left) are stable internal view ids used across the app;
// `label` is what people see. Groups define the sidebar sections, in order.
export const NAV = {
  "Dashboard":       { label: "Overview",            icon: "home" },
  "Shift Checklist": { label: "My Shift Checklist",  icon: "clipboard" },
  "Tracker":         { label: "Procedure Tracker",   icon: "tasks" },
  "Shift Logs":      { label: "Checklist Monitor",   icon: "calendarCheck" },
  "Onboarding":      { label: "Staff Onboarding",    icon: "userplus" },
  "Staff":           { label: "Staff Directory",     icon: "users" },
  "Payroll":         { label: "Payroll",             icon: "wallet" },
  "HR":              { label: "Offer Letters",       icon: "file" },
  "Reports":         { label: "Reports & Insights",  icon: "chart" },
  "Attendance":      { label: "Attendance",          icon: "clock" },
  "Documents":       { label: "Documents",           icon: "file" },
  "Policies":        { label: "Policies & SOPs",     icon: "shield" },
  "Learning":        { label: "Training Library",    icon: "cap" },
  "Events":          { label: "Events & Culture",    icon: "party" },
  "Assistant":       { label: "AI Assistant",        icon: "bot" },
  "Clinic Assistant": { label: "Clinic Assistant",   icon: "bot" },
  "Dashboards":      { label: "Clinic Dashboards",   icon: "chart" },
  "AI Advisors":     { label: "AI Advisors",         icon: "sparkles" },
  "System":          { label: "System & Activity",   icon: "shield" },
  // staff-layout only
  "My checklist":    { label: "My Tasks",            icon: "list" },
  "My Profile":      { label: "My Profile",          icon: "user" },
};

export const NAV_GROUPS = [
  { title: "Workspace",   keys: ["Dashboard", "My checklist", "Shift Checklist", "Tracker"] },
  { title: "People",      keys: ["Attendance", "Shift Logs", "Onboarding", "Staff", "My Profile", "Payroll", "HR"] },
  { title: "Insights",    keys: ["Reports", "Dashboards"] },
  { title: "Knowledge",   keys: ["Documents", "Policies", "Learning", "Events"] },
  { title: "AI Tools",    keys: ["Clinic Assistant", "Assistant", "AI Advisors"] },
  { title: "Administration", keys: ["System"] },
];

export function navItemsFor(user) {
  const items = ["Dashboard", "Shift Checklist", "Tracker", "Reports", "Documents", "Policies", "Learning", "Events", "Clinic Assistant", "Assistant", "AI Advisors"];
  if (user.role === "admin" || user.role === "manager") items.push("Attendance", "Shift Logs", "Dashboards");
  if (user.role === "admin") items.push("Onboarding", "Staff", "Payroll", "HR", "System");
  return items;
}
