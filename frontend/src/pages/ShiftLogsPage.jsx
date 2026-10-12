import { useEffect, useState, useCallback } from "react";
import { navItemsFor } from "../navItems.js";
import { api, assetUrl } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";
import Icon, { initials } from "../components/Icon.jsx";

const todayISO = () => new Date().toISOString().slice(0, 10);
const utc = (s) => new Date(String(s).replace(" ", "T") + "Z");

export default function ShiftLogsPage({ user, onLogout, onBack, onOpenProfile }) {
  const [date, setDate] = useState(todayISO());
  const [shift, setShift] = useState("");
  const [view, setView] = useState("all");
  const [data, setData] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openPhoto, setOpenPhoto] = useState(null);
  const [openDetail, setOpenDetail] = useState(null);

  const refresh = useCallback(() => {
    const params = { date };
    if (shift) params.shift = shift;
    api.getShiftChecklistSubmissions(params).then(setData).catch(() => setData({ submissions: [], missing: [] }));
  }, [date, shift]);
  // Live: refresh every 8 seconds so staff progress appears as they tick items.
  useEffect(() => { refresh(); const id = setInterval(refresh, 8000); return () => clearInterval(id); }, [refresh]);

  const all = data?.submissions || [];
  const missing = data?.missing || [];
  const submitted = all.filter((s) => s.status === "submitted");
  const inProgress = all.filter((s) => s.status === "in_progress");
  const avgPct = submitted.length === 0 ? null : Math.round(submitted.reduce((s, r) => s + r.completionPct, 0) / submitted.length);
  const rows = view === "submitted" ? submitted : view === "in_progress" ? inProgress : all;

  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="Shift Logs"
        onSelect={(item) => item !== "Shift Logs" && onBack(item)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`} onLogout={onLogout}
        mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <main className="main">
        <MobileTopBar title="Shift Logs" onOpenMenu={() => setMobileOpen(true)} />
        <div className="page-head row">
          <div>
            <div className="eyebrow">People</div>
            <h1>Checklist Monitor</h1>
            <p>Every role's Opening / During the day / End of day checklist, live. Progress appears here as staff tick items — no waiting for them to submit.</p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 160 }} />
            <select className="field" value={shift} onChange={(e) => setShift(e.target.value)} style={{ width: 140 }}>
              <option value="">All shifts</option><option value="Morning">Morning</option><option value="Evening">Evening</option>
            </select>
          </div>
        </div>

        <div className="kpi-grid">
          <Kpi icon="check" tone="green" value={submitted.length} label="Submitted" hint={avgPct === null ? "—" : `${avgPct}% average completion`} />
          <Kpi icon="clock" tone="amber" value={inProgress.length} label="In progress now" hint="Updating live" />
          <Kpi icon="alert" tone={missing.length ? "red" : "green"} value={missing.length} label="Not started" hint={missing.length ? "Send a reminder" : "Everyone has started"} />
          <Kpi icon="users" tone="blue" value={all.length + missing.length} label="Staff on checklists" />
        </div>

        <div className="pill-row">
          {[["all", "All", all.length], ["submitted", "Submitted", submitted.length], ["in_progress", "In progress", inProgress.length]].map(([k, l, n]) => (
            <button key={k} className={`pill ${view === k ? "active" : ""}`} onClick={() => setView(k)}>{l}<span className="n">{n}</span></button>
          ))}
        </div>

        {data === null && <div className="empty">Loading…</div>}
        {data && rows.length === 0 && <div className="empty">No checklists in this view for {date}.</div>}

        {rows.map((s) => (
          <div key={s.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div className="person-row">
                <div className="avatar">{initials(s.staffName)}</div>
                <div className="info">
                  <div className="nm"><span className="link" onClick={() => onOpenProfile(s.userId)}>{s.staffName}</span></div>
                  <div className="sub">{s.roleName} · {s.shift} shift · {s.status === "submitted" ? `submitted ${utc(s.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : `last update ${utc(s.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</div>
                </div>
              </div>
              <span className={`badge ${s.status === "submitted" ? "done" : "in_progress"}`}>{s.status === "submitted" ? "Submitted" : "In progress"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
              <div className={`progress lg ${s.status === "submitted" ? (s.completionPct === 100 ? "green" : "") : "amber"}`} style={{ flex: 1 }}><span style={{ width: `${s.completionPct}%` }} /></div>
              <strong style={{ fontSize: 13, minWidth: 90, textAlign: "right" }}>{s.completed}/{s.total} · {s.completionPct}%</strong>
            </div>
            {s.metrics && Object.values(s.metrics).some(Boolean) && (
              <div style={{ marginTop: 12 }}>
                {Object.entries(s.metrics).filter(([, v]) => v).map(([k, v]) => <span key={k} className="chip">{k}: <strong>{v}</strong></span>)}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
              {s.photoUrl && <img src={assetUrl(s.photoUrl)} alt="Evidence" style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 12, cursor: "pointer" }} onClick={() => setOpenPhoto(s)} />}
              {s.photoAiCheck && <div className="meta" style={{ flex: 1, minWidth: 180 }}>{s.photoAiCheck}</div>}
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => setOpenDetail(openDetail === s.id ? null : s.id)}>{openDetail === s.id ? "Hide items" : "View items"}</button>
            </div>
            {openDetail === s.id && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10, maxHeight: 320, overflowY: "auto" }}>
                {s.items.map((i, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 10, padding: "6px 0", fontSize: 13, color: i.done ? "var(--ink)" : "var(--ink-soft)" }}>
                    <span style={{ color: i.done ? "var(--green)" : "var(--red)", fontWeight: 800, width: 16 }}>{i.done ? "✓" : "✗"}</span>
                    <span><span className="meta">{i.section} · </span>{i.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {missing.length > 0 && (
          <>
            <div className="section-head"><h2>Not started ({missing.length})</h2></div>
            <div className="card">
              {missing.map((m) => (
                <div key={m.userId} className="task-row">
                  <div className="person-row" style={{ gap: 10 }}>
                    <div className="avatar sm">{initials(m.name)}</div>
                    <div className="info"><div className="nm link" style={{ fontSize: 13.5 }} onClick={() => onOpenProfile(m.userId)}>{m.name}</div><div className="sub">{m.roleName}</div></div>
                  </div>
                  <span className="badge issue">Not started</span>
                </div>
              ))}
            </div>
          </>
        )}

        {openPhoto && (
          <div className="modal-backdrop" onClick={() => setOpenPhoto(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
              <h3>{openPhoto.staffName} — {openPhoto.shift} evidence</h3>
              <img src={assetUrl(openPhoto.photoUrl)} alt="Evidence" style={{ width: "100%", borderRadius: 14, marginTop: 12 }} />
              <p className="meta" style={{ marginTop: 12 }}>Live timestamp: {openPhoto.photoLiveTimestamp || "not recorded"}</p>
              <p className="meta">AI check: {openPhoto.photoAiCheck}</p>
              <div className="actions"><button className="btn btn-ghost" onClick={() => setOpenPhoto(null)}>Close</button></div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Kpi({ icon, tone, value, label, hint }) {
  return (
    <div className="kpi">
      <div className="kpi-top"><div className={`kpi-ico ${tone}`}><Icon name={icon} size={19} /></div></div>
      <div className="value">{value}</div>
      <div><div className="label">{label}</div>{hint && <div className="hint">{hint}</div>}</div>
    </div>
  );
}
