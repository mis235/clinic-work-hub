import { useState, useEffect } from "react";
import { api } from "./api.js";
import Login from "./pages/Login.jsx";
import AdminDashboard from "./pages/AdminDashboard.jsx";
import StaffDashboard from "./pages/StaffDashboard.jsx";
import PoliciesPage from "./pages/PoliciesPage.jsx";
import ReportsPage from "./pages/ReportsPage.jsx";
import AboutPage from "./pages/AboutPage.jsx";
import LearningPage from "./pages/LearningPage.jsx";
import EventsPage from "./pages/EventsPage.jsx";
import LeavePage from "./pages/LeavePage.jsx";
import OfferLettersPage from "./pages/OfferLettersPage.jsx";
import PayrollPage from "./pages/PayrollPage.jsx";
import StaffAdminPage from "./pages/StaffAdminPage.jsx";
import AssistantPage from "./pages/AssistantPage.jsx";
import TrackerPage from "./pages/TrackerPage.jsx";
import ShiftChecklistPage from "./pages/ShiftChecklistPage.jsx";
import ShiftLogsPage from "./pages/ShiftLogsPage.jsx";
import StaffProfilePage from "./pages/StaffProfilePage.jsx";
import SystemPage from "./pages/SystemPage.jsx";
import ConnectedToolPage from "./pages/ConnectedToolPage.jsx";
import ClinicAIPage from "./pages/ClinicAIPage.jsx";
import AttendancePage from "./pages/AttendancePage.jsx";
import ExitsPage from "./pages/ExitsPage.jsx";
import ClinicDashboardPage from "./pages/ClinicDashboardPage.jsx";
import DepartmentsPage from "./pages/DepartmentsPage.jsx";
import DocumentsPage from "./pages/DocumentsPage.jsx";
import KioskPage from "./pages/KioskPage.jsx";
import ChangePinModal from "./components/ChangePinModal.jsx";

const VIEW_KEY = {
  "Dashboard": "dashboard", "AI Advisors": "assistant", "Policies": "policies", "Reports": "reports",
  "About": "about", "Learning": "learning", "Events": "events", "HR": "hr", "Payroll": "payroll", "Staff": "staff",
  "Assistant": "assistant", "Tracker": "tracker", "Shift Checklist": "shiftchecklist", "Shift Logs": "shiftlogs", "Onboarding": "onboarding", "System": "system", "Attendance": "attendance", "Clinic Assistant": "clinicassistant", "Dashboards": "dashboards", "Documents": "documents", "Departments": "departments", "Roster": "roster", "Exits": "exits", "Leave": "leave",
};

export default function App() {
  return window.location.pathname === "/kiosk" ? <KioskPage /> : <MainApp />;
}

function MainApp() {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  });
  const [view, setView] = useState("dashboard");
  // Check the saved sign-in as soon as the app opens, so an old login is cleared right away instead of failing mid-task.
  useEffect(() => {
    if (!localStorage.getItem("token")) return;
    api.portalMe().then((m) => {   // pick up access changes the admin made since this person last signed in
      const a = m?.access; if (!a) return;
      setUser((u) => {
        if (!u || (u.role === a.role && !!u.isHr === !!a.isHr && !!u.leadership === !!a.leadership)) return u;
        const next = { ...u, role: a.role, isHr: a.isHr, leadership: a.leadership };
        localStorage.setItem("user", JSON.stringify(next)); return next;
      });
    }).catch(() => {});
  }, []);
  const [profile, setProfile] = useState(null); // { id, from } while viewing a staff profile

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
    setView("dashboard");
  }
  function navigate(item) {
    setView(VIEW_KEY[item] || item);
  }
  function openProfile(id, from) {
    setProfile({ id, from });
    setView("staffprofile");
  }

  if (!user) return <Login onLoggedIn={setUser} />;

  function pinChanged() {
    const next = { ...user, mustChangePin: false };
    localStorage.setItem("user", JSON.stringify(next));
    setUser(next);
  }
  const pinGate = user.mustChangePin ? <ChangePinModal forced onDone={pinChanged} /> : null;
  return <>{pinGate}{renderApp()}</>;

  function renderApp() {
  if (user.role === "admin" || user.role === "manager") {
    if (view === "system" && user.role === "admin") return <SystemPage user={user} onLogout={logout} onBack={navigate} />;
    if (view === "clinicassistant") return <ClinicAIPage user={user} onLogout={logout} onBack={navigate} />;
    if (view === "dashboards") return <ClinicDashboardPage user={user} onLogout={logout} onBack={navigate} onNavigate={navigate} />;
    if (view === "exits" && user.role === "admin") return <ExitsPage user={user} onLogout={logout} onBack={navigate} />;
    if (view === "leave") return <LeavePage user={user} onLogout={logout} onBack={navigate} />;
    if (view === "attendance") return <AttendancePage user={user} onLogout={logout} onBack={navigate} />;
    if (view === "departments") return <DepartmentsPage user={user} onLogout={logout} onBack={navigate} onOpenProfile={(id) => openProfile(id, "Departments")} />;
    if (view === "documents") return <DocumentsPage user={user} onLogout={logout} onBack={navigate} />;
    if (view === "assistant") return <AssistantPage user={user} onLogout={logout} onBack={navigate} />;
    if (view === "tracker") return <TrackerPage user={user} onLogout={logout} onBack={navigate} />;
    if (view === "shiftchecklist") return <ShiftChecklistPage user={user} onLogout={logout} onBack={navigate} />;
    if (view === "shiftlogs") return <ShiftLogsPage user={user} onLogout={logout} onBack={navigate} onOpenProfile={(id) => openProfile(id, "Shift Logs")} />;
    if (view === "staffprofile" && profile) return <StaffProfilePage user={user} staffId={profile.id} backLabel={profile.from} onLogout={logout} onBack={navigate} />;
    if (view === "policies") return <PoliciesPage user={user} onLogout={logout} onBack={navigate} />;
    if (view === "reports") return <ReportsPage user={user} onLogout={logout} onBack={navigate} />;
    if (view === "about") return <AboutPage user={user} onLogout={logout} onBack={navigate} />;
    if (view === "learning") return <LearningPage user={user} onLogout={logout} onBack={navigate} />;
    if (view === "events") return <EventsPage user={user} onLogout={logout} onBack={navigate} />;
    if (view === "hr" && user.role === "admin") return <OfferLettersPage user={user} onLogout={logout} onBack={navigate} />;
    if (view === "payroll" && user.role === "admin") return <PayrollPage user={user} onLogout={logout} onBack={navigate} />;
    if (view === "staff" && user.role === "admin") return <StaffAdminPage user={user} onLogout={logout} onBack={navigate} onOpenProfile={(id) => openProfile(id, "Staff")} />;
    return <AdminDashboard user={user} onLogout={logout} onNavigate={navigate} onOpenProfile={(id) => openProfile(id, "Dashboard")} />;
  }
  return <StaffDashboard user={user} onLogout={logout} />;
  }
}
