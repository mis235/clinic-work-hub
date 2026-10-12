// Hosted build: the backend serves this app, so API calls go to the same address ("").
// Local dev (npm run dev): backend is on port 4000.
const BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? "" : "http://localhost:4000");

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function req(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// For multipart/form-data uploads (photo evidence) — no Content-Type header,
// the browser sets it (with the right boundary) when the body is a FormData.
async function reqForm(path, formData) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { ...authHeaders() }, body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function assetUrl(path) {
  if (!path) return path;
  return path.startsWith("http") ? path : `${BASE}${path}`;
}

export const api = {
  login: (credentials) => req("/api/auth/login", { method: "POST", body: credentials }),
  listRoster: () => req("/api/users"),
  listRosterFull: () => req("/api/users/full"),
  listShiftRoles: () => req("/api/users/shift-roles"),
  getStaffProfile: (id) => req(`/api/users/${id}/profile`),
  listTasks: () => req("/api/tasks"),
  createTask: (payload) => req("/api/tasks", { method: "POST", body: payload }),
  sendTask: (id) => req(`/api/tasks/${id}/send`, { method: "POST" }),
  setStatus: (id, status) => req(`/api/tasks/${id}/status`, { method: "PATCH", body: { status, channel: "web" } }),

  // Biometric attendance (WebAuthn — the phone's own fingerprint/Face ID)
  registeredDevices: () => req("/api/attendance/registered"),
  registrationOptions: () => req("/api/attendance/register/options"),
  registrationVerify: (body) => req("/api/attendance/register/verify", { method: "POST", body }),
  checkinOptions: () => req("/api/attendance/checkin/options"),
  checkinVerify: (body) => req("/api/attendance/checkin/verify", { method: "POST", body }),
  listAttendance: () => req("/api/attendance"),
  listTemplates: () => req("/api/templates"),
  listAdvisors: () => req("/api/advisors"),
  chatWithAdvisor: (id, messages) => req(`/api/advisors/${id}/chat`, { method: "POST", body: { messages } }),
  listPolicies: () => req("/api/policies"),
  acknowledgePolicy: (id) => req(`/api/policies/${id}/acknowledge`, { method: "POST" }),
  getReports: () => req("/api/reports/summary"),
  getAbout: () => req("/api/hr/about"),
  listTeam: () => req("/api/hr/team"),
  addTeamProfile: (payload) => req("/api/hr/team", { method: "POST", body: payload }),
  listOfferLetters: () => req("/api/hr/offer-letters"),
  createOfferLetter: (payload) => req("/api/hr/offer-letters", { method: "POST", body: payload }),
  listTrainingVideos: () => req("/api/hr/training-videos"),
  addTrainingVideo: (payload) => req("/api/hr/training-videos", { method: "POST", body: payload }),
  markVideoWatched: (id) => req(`/api/hr/training-videos/${id}/watched`, { method: "POST" }),
  getEvents: () => req("/api/hr/events"),
  addEvent: (payload) => req("/api/hr/events", { method: "POST", body: payload }),
  getSystemStatus: () => req("/api/admin/status"),
  getAuditLog: (limit = 100) => req(`/api/admin/audit?limit=${limit}`),
  getBackups: () => req("/api/admin/backups"),
  createBackup: () => req("/api/admin/backups", { method: "POST", body: {} }),
  getOnboarding: () => req("/api/users/onboarding"),
  createStaff: (payload) => req("/api/users", { method: "POST", body: payload }),
  setOnboardingDocs: (id, docs) => req(`/api/users/${id}/onboarding-docs`, { method: "PATCH", body: { docs } }),
  changeMyPin: (currentPin, newPin) => req("/api/users/me/pin", { method: "POST", body: { currentPin, newPin } }),
  resetStaffPin: (id, newPin) => req(`/api/users/${id}/reset-pin`, { method: "POST", body: { newPin } }),
  saveShiftProgress: (payload) => req("/api/shift-checklist/progress", { method: "POST", body: payload }),
  updateUser: (id, payload) => req(`/api/users/${id}`, { method: "PATCH", body: payload }),
  listCompanies: () => req("/api/companies"),
  getPayProfile: (userId) => req(`/api/payroll/profile/${userId}`),
  listPayProfiles: () => req("/api/payroll/profiles"),
  setPayProfile: (payload) => req("/api/payroll/profile", { method: "POST", body: payload }),
  generatePayroll: (payload) => req("/api/payroll/generate", { method: "POST", body: payload }),
  listPayslips: () => req("/api/payroll"),
  runMonthlyPayrollNow: () => req("/api/jobs/run-monthly-payroll", { method: "POST" }),
  runChecklistDigestNow: () => req("/api/jobs/run-checklist-digest", { method: "POST" }),

  // Staff Assistant chatbot + personal Tracker (available to every role)
  getAssistantFaqs: () => req("/api/assistant/faqs"),
  askAssistant: (message) => req("/api/assistant/ask", { method: "POST", body: { message } }),
  getMySummary: () => req("/api/reports/my-summary"),

  // Shift checklist (the real recurring Opening/During-the-day/End-of-day
  // checklist per role, ported from the Apps Script system) — distinct from
  // the ad-hoc "tasks" above.
  getShiftChecklistTemplate: () => req("/api/shift-checklist/template"),
  getShiftChecklistToday: () => req("/api/shift-checklist/today"),
  submitShiftChecklist: (formData) => reqForm("/api/shift-checklist/submit", formData),
  getShiftChecklistSubmissions: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req(`/api/shift-checklist/submissions${qs ? `?${qs}` : ""}`);
  },
};
