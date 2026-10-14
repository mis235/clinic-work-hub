// Hosted build: the backend serves this app, so API calls go to the same address ("").
// Local dev (npm run dev): backend is on port 4000.
const BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? "" : "http://localhost:4000");

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function sessionExpired() {
  try { sessionStorage.setItem("sessionMsg", "Your sign-in ended (for safety it lasts a few days). Please sign in again."); } catch {}
  localStorage.removeItem("token"); localStorage.removeItem("user");
  window.location.reload();
}
const checkAuth = (res, path) => { if (res.status === 401 && path !== "/api/auth/login" && localStorage.getItem("token")) sessionExpired(); };

async function req(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/auth/login" && localStorage.getItem("token")) { sessionExpired(); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// For multipart/form-data uploads (photo evidence) — no Content-Type header,
// the browser sets it (with the right boundary) when the body is a FormData.
async function reqForm(path, formData) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { ...authHeaders() }, body: formData });
  checkAuth(res, path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}


// Download a protected file: fetch with the login token, then hand the browser a blob to save.
export async function downloadFile(path, fallbackName = "download", { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...authHeaders() }, body: body ? JSON.stringify(body) : undefined,
  });
  checkAuth(res, path);
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Download failed"); }
  const cd = res.headers.get("Content-Disposition") || "";
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function videoStreamUrl(id) {
  return `${BASE}/api/hr/training-videos/${id}/stream?token=${encodeURIComponent(localStorage.getItem("token") || "")}`;
}

export function assetUrl(path) {
  if (!path) return path;
  return path.startsWith("http") ? path : `${BASE}${path}`;
}

export const api = {
  listStaffFiles: (userId) => req(`/api/documents/staff/${userId}`),
  addStaffFile: (userId, formData) => reqForm(`/api/documents/staff/${userId}`, formData),
  listLinks: () => req("/api/links"),
  setLink: (key, payload) => req(`/api/links/${key}`, { method: "PUT", body: payload }),
  // Documents hub
  listDocuments: () => req("/api/documents"),
  addDocument: (formData) => reqForm("/api/documents", formData),
  deleteDocument: (id) => req(`/api/documents/${id}`, { method: "DELETE" }),
  downloadDocument: (id, name) => downloadFile(`/api/documents/${id}/file`, name),

  // Word templates + bulk generation
  templateFields: () => req("/api/doc-templates/fields"),
  listDocTemplates: (kind) => req(`/api/doc-templates${kind ? `?kind=${kind}` : ""}`),
  uploadDocTemplate: (formData) => reqForm("/api/doc-templates", formData),
  deleteDocTemplate: (id) => req(`/api/doc-templates/${id}`, { method: "DELETE" }),
  downloadSampleTemplate: (kind) => downloadFile(`/api/doc-templates/sample/${kind}`, `sample-${kind}.docx`),
  downloadTemplate: (id, name) => downloadFile(`/api/doc-templates/${id}/file`, name),
  prefillDocs: (payload) => req("/api/doc-templates/prefill", { method: "POST", body: payload }),
  generateDocs: (payload) => req("/api/doc-templates/generate", { method: "POST", body: payload }),
  listGeneratedDocs: (kind) => req(`/api/doc-templates/generated${kind ? `?kind=${kind}` : ""}`),
  downloadGenerated: (id, name) => downloadFile(`/api/doc-templates/generated/${id}/file`, name),
  downloadGeneratedZip: (ids) => downloadFile("/api/doc-templates/generated/zip", "documents.zip", { method: "POST", body: { ids } }),
  emailGenerated: (ids) => req("/api/doc-templates/generated/email", { method: "POST", body: { ids } }),
  emailSettings: () => req("/api/admin/email"),
  saveEmailSettings: (body) => req("/api/admin/email", { method: "PUT", body }),
  testEmail: (to) => req("/api/admin/email/test", { method: "POST", body: { to } }),
  shiftItemPhoto: (file) => { const fd = new FormData(); fd.append("photo", file); return reqForm("/api/shift-checklist/item-photo", fd); },
  checklistDashboard: (date, days) => req(`/api/shift-checklist/dashboard?date=${date}&days=${days || 14}`),
  checklistSheet: () => req("/api/shift-checklist/sheet"),
  saveChecklistSheet: (url) => req("/api/shift-checklist/sheet", { method: "PUT", body: { url } }),
  syncChecklistSheet: () => req("/api/shift-checklist/sheet/sync", { method: "POST" }),
  deleteGenerated: (id) => req(`/api/doc-templates/generated/${id}`, { method: "DELETE" }),

  // Staff exits
  exitsMeta: () => req("/api/exits/meta"),
  exitsList: () => req("/api/exits"),
  exitGet: (id) => req(`/api/exits/${id}`),
  exitStart: (b) => req("/api/exits", { method: "POST", body: b }),
  exitUpdate: (id, b) => req(`/api/exits/${id}`, { method: "PATCH", body: b }),
  exitAdvance: (id) => req(`/api/exits/${id}/advance`, { method: "POST" }),
  exitBack: (id) => req(`/api/exits/${id}/back`, { method: "POST" }),
  exitWithdraw: (id) => req(`/api/exits/${id}/withdraw`, { method: "POST" }),
  exitLetter: (id, kind) => req(`/api/exits/${id}/letters`, { method: "POST", body: { kind } }),

  // One-tap attendance
  attendanceToday: () => req("/api/attendance/today"),
  attendancePunch: (payload) => req("/api/attendance/punch", { method: "POST", body: payload }),
  attendanceBoard: (date) => req(`/api/attendance/board${date ? `?date=${date}` : ""}`),
  attendanceMonth: (month) => req(`/api/attendance/month${month ? `?month=${month}` : ""}`),
  markAttendance: (userId, date, status) => req("/api/attendance/mark", { method: "PUT", body: { userId, date, status } }),
  markAttendanceDay: (date, status) => req("/api/attendance/mark-day", { method: "POST", body: { date, status } }),
  attendanceRegister: (month) => req(`/api/attendance/register${month ? `?month=${month}` : ""}`),
  fines: (month, userId) => req(`/api/fines?month=${month || ""}${userId ? `&userId=${userId}` : ""}`),
  finesSummary: (month) => req(`/api/fines/summary?month=${month || ""}`),
  addFine: (body) => req("/api/fines", { method: "POST", body }),
  deleteFine: (id) => req(`/api/fines/${id}`, { method: "DELETE" }),
  workspace: (deptId) => req("/api/workspace/" + deptId),
  addWorkspaceItem: (deptId, body) => req("/api/workspace/" + deptId, { method: "POST", body }),
  editWorkspaceItem: (id, body) => req("/api/workspace/item/" + id, { method: "PATCH", body }),
  deleteWorkspaceItem: (id) => req("/api/workspace/item/" + id, { method: "DELETE" }),
  portalDepartments: () => req("/api/portal/departments"),
  portalDepartment: (id) => req(`/api/portal/departments/${id}`),
  checkLink: (key) => req(`/api/links/${key}/check`),
  rosterWeek: (start) => req(`/api/roster/week${start ? `?start=${start}` : ""}`),
  setShift: (userId, date, shift) => req("/api/roster", { method: "PUT", body: { userId, date, shift } }),
  copyWeek: (from, to) => req("/api/roster/copy-week", { method: "POST", body: { from, to } }),
  addShiftType: (b) => req("/api/roster/types", { method: "POST", body: b }),
  editShiftType: (k, b) => req(`/api/roster/types/${k}`, { method: "PATCH", body: b }),
  deleteShiftType: (k) => req(`/api/roster/types/${k}`, { method: "DELETE" }),
  setShiftBulk: (userId, dates, shift) => req("/api/roster/bulk", { method: "PUT", body: { userId, dates, shift } }),
  rosterMe: () => req("/api/roster/me"),
  portalMe: () => req("/api/portal/me"),
  manualAttendance: (userId, type) => req("/api/attendance/manual", { method: "POST", body: { userId, type } }),

  // Staff management
  uploadPhoto: (id, file) => { const fd = new FormData(); fd.append("photo", file); return reqForm(`/api/users/${id}/photo`, fd); },
  removePhoto: (id) => req(`/api/users/${id}/photo`, { method: "DELETE" }),
  checkFaceDuplicate: (descriptors, exceptUserId) => req("/api/kiosk/check-duplicate", { method: "POST", body: { descriptors, exceptUserId } }),
  kioskLan: () => req("/api/kiosk/lan"),
  downloadAttendanceXlsx: (month) => downloadFile(`/api/attendance/export?month=${month}`, `attendance-${month}.xlsx`),
  enrolledFaces: () => req("/api/kiosk/enrolled"),
  enrollFace: (id, descriptors) => req(`/api/kiosk/enroll/${id}`, { method: "POST", body: { descriptors } }),
  removeFace: (id) => req(`/api/kiosk/enroll/${id}`, { method: "DELETE" }),
  kioskDevices: () => req("/api/kiosk/devices"),
  createKioskDevice: (label) => req("/api/kiosk/devices", { method: "POST", body: { label } }),
  revokeKioskDevice: (id) => req(`/api/kiosk/devices/${id}`, { method: "DELETE" }),
  kioskLog: (date) => req(`/api/kiosk/log?date=${date}`),
  renameFolder: (body) => req("/api/hr/training-folders/rename", { method: "POST", body }),
  listRosterAll: () => req("/api/users/full?includeInactive=1"),
  removeStaff: (id) => req(`/api/users/${id}/deactivate`, { method: "PATCH" }),
  restoreStaff: (id) => req(`/api/users/${id}/reactivate`, { method: "PATCH" }),

  // Training library (upload or link, edit, delete)
  addTrainingVideoForm: (formData) => reqForm("/api/hr/training-videos", formData),
  updateTrainingVideo: (id, payload) => req(`/api/hr/training-videos/${id}`, { method: "PATCH", body: payload }),
  deleteTrainingVideo: (id) => req(`/api/hr/training-videos/${id}`, { method: "DELETE" }),
  trainingProgress: () => req("/api/hr/training-videos/progress"),

  // History import (old Google Sheet export)
  importChecklistHistory: (formData) => reqForm("/api/shift-checklist/import", formData),

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
  getReports: (days = 30) => req(`/api/reports/summary?days=${days}`),
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

// Pictures are private: <img> tags cannot send headers, so the sign-in token goes in the address.
export const photoUrl = (id, v = "") => `${BASE}/api/users/${id}/photo?token=${encodeURIComponent(localStorage.getItem("token") || "")}&v=${v}`;
export const snapUrl = (id) => `${BASE}/api/kiosk/snap/${id}?token=${encodeURIComponent(localStorage.getItem("token") || "")}`;

// The clinic phone talks to the server with its own limited key (it never signs in as a person).
export const kioskApi = {
  key: () => { try { return localStorage.getItem("kioskKey") || ""; } catch { return ""; } },
  async call(path, body) {
    const res = await fetch(`${BASE}/api/kiosk/${path}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", Authorization: `Bearer ${kioskApi.key()}` }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
    return data;
  },
};
