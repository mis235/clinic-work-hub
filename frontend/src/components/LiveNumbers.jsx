import { useEffect, useState } from "react";
import { api } from "../api.js";

const rs = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const mon = (m) => (m ? new Date(m + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }) : "");
const COL = "#c42f8f", GOLD = "#d49a2a", GREEN = "#12a56f";

function Bars({ items, val = (x) => x.n, label = (x) => x.k, fmt = (n) => n, color = COL }) {
  const max = Math.max(1, ...items.map(val));
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {items.map((x, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(90px,150px) 1fr 70px", gap: 8, alignItems: "center", fontSize: 13 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={label(x)}>{label(x)}</span>
          <div style={{ background: "var(--line, #eee)", borderRadius: 6, height: 12 }}><div style={{ width: `${(val(x) / max) * 100}%`, background: color, height: 12, borderRadius: 6, minWidth: val(x) ? 3 : 0 }} /></div>
          <b style={{ textAlign: "right" }}>{fmt(val(x))}</b>
        </div>))}
    </div>);
}
function Columns({ items, val, label, color = COL, fmt = (n) => n }) {
  const max = Math.max(1, ...items.map(val));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 150 }}>
      {items.map((x, i) => (
        <div key={i} title={`${label(x)}: ${fmt(val(x))}`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", minWidth: 0 }}>
          <div style={{ fontSize: 10, textAlign: "center" }}>{val(x) ? fmt(val(x)) : ""}</div>
          <div style={{ background: color, borderRadius: 4, height: `${(val(x) / max) * 100}%`, minHeight: val(x) ? 3 : 0 }} />
          <div className="meta" style={{ fontSize: 10, textAlign: "center", marginTop: 2 }}>{label(x)}</div>
        </div>))}
    </div>);
}
const Kpi = ({ l, v, c = COL, sub }) => <div className="kpi" style={{ "--kc": c }}><div className="meta">{l}</div><div className="kpi-v">{v}</div>{sub && <div className="meta">{sub}</div>}</div>;
const Card = ({ t, children, sub }) => <div className="card"><div className="title" style={{ marginBottom: 2 }}>{t}</div>{sub && <div className="meta" style={{ marginBottom: 8 }}>{sub}</div>}{children}</div>;

const SETUP = typeof location !== "undefined" && new URLSearchParams(location.search).has("setup");
export default function LiveNumbers({ user }) {
  const [sec, setSec] = useState("conv"), [d, setD] = useState(null), [cfg, setCfg] = useState(null), [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [open, setOpen] = useState(false);
  const load = () => api.liveNumbers().then(setD).catch((e) => setMsg(e.message));
  const loadCfg = () => user.role === "admin" && api.liveConfig().then((c) => { setCfg(c); setUrl(c.url || ""); }).catch(() => {});
  useEffect(() => { load(); loadCfg(); const t = setInterval(load, 60000); window.addEventListener("hub-refresh", load); return () => { clearInterval(t); window.removeEventListener("hub-refresh", load); }; }, []);
  const x = d?.data, hv = d?.heavy, isAdmin = user.role === "admin";
  const copy = (t) => { navigator.clipboard?.writeText(t); setMsg("Copied."); };
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {isAdmin && SETUP && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div className="meta">{d?.status || "Not connected yet."} {x?.updatedAt ? `· numbers as of ${x.updatedAt}` : ""}{d?.heavyStatus ? ` · big sheets: ${d.heavyStatus}` : ""}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-outline btn-sm" disabled={busy || !cfg?.url} onClick={async () => { setBusy(true); setMsg(""); try { const rr = await api.refreshLive(); await load(); await loadCfg(); setMsg(rr?.heavy === false ? `Updated. Big sheets: ${rr.heavyError || "not read"}` : "Updated."); } catch (e) { setMsg(e.message); } setBusy(false); }}>{busy ? "Reading sheets…" : "Update now"}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>{open ? "Hide setup" : "Setup"}</button>
            </div>
          </div>
          {msg && <div className="meta" style={{ marginTop: 6 }}>{msg}</div>}
          {(open || !d?.configured) && cfg && (
            <div style={{ marginTop: 10 }}>
              <div className="meta"><b>Set up once (5 minutes), on the Google account that owns the sheets:</b></div>
              <ol className="meta" style={{ margin: "4px 0 8px 18px", lineHeight: 1.7 }}>
                <li>Open <b>script.google.com</b> and click <b>New project</b>. Delete everything in the editor.</li>
                <li><button className="btn btn-outline btn-sm" onClick={() => copy(cfg.script)}>Copy the script</button> and paste it into the editor. Click the save icon.</li>
                <li>Click <b>Deploy → New deployment</b>. Click the gear and choose <b>Web app</b>. “Execute as” = Me, “Who has access” = <b>Anyone</b>. Click Deploy and allow access when asked.</li>
                <li>Copy the <b>Web app URL</b> (ends with /exec), paste it below, press Save, then Update now.</li>
              </ol>
              <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" />
              <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={async () => { try { await api.saveLiveConfig(url); setMsg("Saved. Press Update now."); loadCfg(); load(); } catch (e) { setMsg(e.message); } }}>Save</button>
            </div>)}
        </div>)}

      {!x && <div className="empty">Loading…</div>}
      {SETUP && x && Object.keys(x.errors || {}).length > 0 && <div className="card meta">Some sheets could not be read: {Object.entries(x.errors).map(([k, v]) => `${k} (${v})`).join(" · ")}</div>}

      {(x || hv) && (
        <div className="pill-row">
          {[["conv", "Conversions"], ["daily", "Daily Procedures"], ["sales", "Clinic Sales"], ["pack", "Package Sheet"], ["pharm", "Purchase & Pharmacy"], ["deliv", "Procedure Delivery"], ["master", "Master"], ["hr", "Human Resources"], ["search", "Patient Search"], ["leads", "Leads"]].map(([k, l]) => <button key={k} className={`pill ${sec === k ? "active" : ""}`} onClick={() => setSec(k)}>{l}</button>)}
        </div>)}
      {SETUP && hv && Object.keys(hv.errors || {}).length > 0 && <div className="card meta">Some big sheets could not be read: {Object.entries(hv.errors).map(([k, v]) => `${k} (${v})`).join(" · ")}</div>}
      {!hv && x && ["conv", "pack", "pharm", "deliv", "master", "hr"].includes(sec) && <div className="empty">Loading…</div>}
      {(() => { const fk = (n) => (n >= 10000000 ? (n / 10000000).toFixed(1) + "Cr" : n >= 100000 ? (n / 100000).toFixed(1) + "L" : n >= 1000 ? Math.round(n / 1000) + "k" : n); return (<>

      {sec === "conv" && hv?.conv && (<>
        <div className="kpi-row">
          {hv.conv.years.slice(-1).map((y) => <Kpi key="a" l={`Conversion rate · ${y.y}`} v={y.rate + "%"} c={GREEN} sub={`${y.done} done of ${y.sug} suggested`} />)}
          {hv.conv.years.slice(-1).map((y) => <Kpi key="b" l="Not done yet" v={y.sug - y.done} c={GOLD} />)}
        </div>
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Suggested vs done, by year" sub="Done rate %"><Columns items={hv.conv.years} val={(r) => r.rate} label={(r) => r.y} color={GREEN} fmt={(n) => n + "%"} /></Card>
          <Card t="By month" sub="Done rate %"><Columns items={hv.conv.byMonth} val={(r) => (r.sug ? Math.round((r.done / r.sug) * 100) : 0)} label={(r) => mon(r.m)} color={GOLD} fmt={(n) => n + "%"} /></Card>
          <Card t={`By category · ${hv.conv.years.slice(-1)[0]?.y}`} sub="Suggested (done in brackets)"><Bars items={hv.conv.byCategory[hv.conv.years.slice(-1)[0]?.y] || []} val={(r) => r.sug} label={(r) => `${r.k} (${r.done} done)`} color={GOLD} /></Card>
        </div>
      </>)}

      {sec === "daily" && x?.procedures && (<>
        <div className="kpi-row">
          <Kpi l={`Procedures · ${mon(x.procedures.focus)}`} v={x.procedures.thisMonth} />
          <Kpi l="Patients this month" v={x.procedures.patients} />
          <Kpi l="Procedures this year" v={x.procedures.total} c={GOLD} />
        </div>
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Procedures by month"><Columns items={x.procedures.byMonth} val={(r) => r.n} label={(r) => mon(r.m)} /></Card>
          <Card t="Last 14 days"><Columns items={x.procedures.last14} val={(r) => r.n} label={(r) => r.d.slice(8)} color={GOLD} /></Card>
          <Card t="By category"><Bars items={x.procedures.byCategory} /></Card>
          <Card t="Top procedures"><Bars items={x.procedures.topProcedures} color={GOLD} /></Card>
        </div>
      </>)}

      {sec === "sales" && x?.revenue && (<>
        <div className="kpi-row">
          <Kpi l={`Sales · ${mon(x.revenue.focus)}`} v={rs(x.revenue.thisMonth)} c={GREEN} sub={`${x.revenue.invoices} invoices`} />
          <Kpi l="Received" v={rs(x.revenue.paid)} c={GREEN} />
          <Kpi l="Pending this month" v={rs(x.revenue.pending)} c={GOLD} />
          <Kpi l="Pending, all months" v={rs(x.revenue.pendingAll)} c="#d4432a" />
        </div>
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Sales by month" sub="Invoice total"><Columns items={x.revenue.byMonth} val={(r) => r.total} label={(r) => mon(r.m)} color={GREEN} fmt={fk} /></Card>
          <Card t={`Sales by category · ${mon(x.revenue.focus)}`}><Bars items={x.revenue.byCategory} fmt={rs} color={GREEN} /></Card>
        </div>
      </>)}

      {sec === "pack" && hv?.pack && (<>
        <div className="kpi-row">
          <Kpi l="Packages sold" v={hv.pack.total.n} />
          <Kpi l="Package value" v={rs(hv.pack.total.amt)} c={GREEN} />
          <Kpi l="Paid" v={rs(hv.pack.total.paid)} c={GREEN} />
          <Kpi l="Balance to collect" v={rs(hv.pack.total.bal)} c="#d4432a" />
        </div>
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Package value by month"><Columns items={hv.pack.byMonth} val={(r) => r.amt} label={(r) => mon(r.m)} color={GREEN} fmt={fk} /></Card>
          <Card t="Packages sold by month"><Columns items={hv.pack.byMonth} val={(r) => r.n} label={(r) => mon(r.m)} /></Card>
          <Card t="Top procedures by value"><Bars items={hv.pack.byProc} fmt={rs} color={GOLD} label={(r) => `${r.k} (${r.count})`} /></Card>
          <Card t="New vs existing patients"><Bars items={hv.pack.byPatientType} color={GREEN} /></Card>
        </div>
      </>)}

      {sec === "pharm" && hv?.pharm && (<>
        {(() => { const l = hv.pharm.byMonth.slice(-1)[0] || {}; return (
          <div className="kpi-row">
            <Kpi l={`Pharmacy sales · ${mon(hv.pharm.focus)}`} v={rs(l.sales)} c={GREEN} sub={`${l.orders || 0} orders`} />
            <Kpi l="Profit" v={rs(l.profit)} c={GREEN} sub={l.sales ? `${Math.round((l.profit / l.sales) * 100)}% margin` : ""} />
            <Kpi l="Items sold" v={l.qty || 0} c={GOLD} />
          </div>); })()}
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Pharmacy sales by month"><Columns items={hv.pharm.byMonth} val={(r) => r.sales} label={(r) => mon(r.m)} color={GREEN} fmt={fk} /></Card>
          <Card t="Profit by month"><Columns items={hv.pharm.byMonth} val={(r) => r.profit} label={(r) => mon(r.m)} color={GOLD} fmt={fk} /></Card>
          <Card t={`Sales by category · ${mon(hv.pharm.focus)}`}><Bars items={hv.pharm.byCategory} fmt={rs} color={GREEN} /></Card>
          <Card t={`Top medicines · ${mon(hv.pharm.focus)}`}><Bars items={hv.pharm.topMedicines} fmt={rs} color={GOLD} /></Card>
        </div>
      </>)}

      {sec === "deliv" && hv?.deliv && (<>
        <div className="kpi-row">
          <Kpi l={`Procedures delivered · ${mon(hv.deliv.focus)}`} v={hv.deliv.byMonth.slice(-1)[0]?.n || 0} />
          {hv.deliv.byUnique.map((u) => <Kpi key={u.k} l={u.k} v={u.n} c={GOLD} />)}
        </div>
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Procedures delivered by month"><Columns items={hv.deliv.byMonth} val={(r) => r.n} label={(r) => mon(r.m)} /></Card>
          <Card t={`By therapist · ${mon(hv.deliv.focus)}`}><Bars items={hv.deliv.byTherapist} color={GREEN} /></Card>
          <Card t={`By procedure · ${mon(hv.deliv.focus)}`}><Bars items={hv.deliv.byProc} color={GOLD} /></Card>
          <Card t={`By category · ${mon(hv.deliv.focus)}`}><Bars items={hv.deliv.byCategory} /></Card>
        </div>
      </>)}

      {sec === "master" && hv?.master && (<>
        <div className="kpi-row">
          <Kpi l="Patients on file" v={hv.master.total.toLocaleString("en-IN")} />
          {hv.master.byGender.map((g) => <Kpi key={g.k} l={g.k} v={g.n.toLocaleString("en-IN")} c={GOLD} />)}
        </div>
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Patient visit recency" sub="How overdue their next visit is"><Bars items={hv.master.byDue} color={GREEN} /></Card>
          <Card t="By number of visits"><Bars items={hv.master.byVisits} /></Card>
          <Card t="By age range"><Bars items={hv.master.byAge} color={GOLD} /></Card>
        </div>
      </>)}

      {sec === "hr" && hv?.hr && (<>
        <div className="kpi-row"><Kpi l="Candidates called" v={hv.hr.total} /></div>
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Candidates by month"><Columns items={hv.hr.byMonth} val={(r) => r.n} label={(r) => mon(r.m)} /></Card>
          <Card t="By role"><Bars items={hv.hr.byRole} color={GOLD} /></Card>
          <Card t="Interview status"><Bars items={hv.hr.byStatus} color={GREEN} /></Card>
          <Card t="Call status"><Bars items={hv.hr.byCall} /></Card>
          <Card t="Fresher or experienced"><Bars items={hv.hr.byExp} color={GOLD} /></Card>
          <Card t="Source"><Bars items={hv.hr.bySource} color={GREEN} /></Card>
        </div>
      </>)}

      {sec === "search" && <PatientSearch />}

      {sec === "leads" && x?.leads && (<>
        <div className="kpi-row"><Kpi l="Leads (TeleCRM)" v={x.leads.total} /></div>
        {x.leads.total === 0 ? <div className="empty">No leads in the TeleCRM sheet yet. They appear here once TeleCRM sends them.</div> : (
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Leads, last 14 days"><Columns items={x.leads.last14} val={(r) => r.n} label={(r) => r.d.slice(8)} /></Card>
          <Card t="By status"><Bars items={x.leads.byStatus} /></Card>
          <Card t="By source"><Bars items={x.leads.bySource} color={GOLD} /></Card>
          <Card t="By stage"><Bars items={x.leads.byStage} color={GREEN} /></Card>
        </div>)}
      </>)}
      </>); })()}
    </div>);
}

function PatientSearch() {
  const [q, setQ] = useState(""), [r, setR] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const go = async () => { setBusy(true); setErr(""); setR(null); try { setR(await api.patientSearch(q.trim())); } catch (e) { setErr(e.message); } setBusy(false); };
  return (
    <div className="card">
      <div className="title" style={{ marginBottom: 2 }}>Search a patient</div>
      
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="field" style={{ maxWidth: 360 }} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && q.trim().length >= 3 && go()} placeholder="Name, phone or patient ID" />
        <button className="btn btn-primary btn-sm" disabled={busy || q.trim().length < 3} onClick={go}>{busy ? "Searching…" : "Search"}</button>
      </div>
      {err && <div className="note warn" style={{ marginTop: 8 }}>{err}</div>}
      {r && r.rows.length === 0 && <div className="meta" style={{ marginTop: 10 }}>No patient found.</div>}
      {r && r.rows.length > 0 && (
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table className="reg-table"><thead><tr><th>Name</th><th>Patient ID</th><th>Phone</th><th>Gender / age</th><th>Visits</th><th>Last visit</th><th>Next visit</th></tr></thead>
            <tbody>{r.rows.map((p) => <tr key={p.id}><td className="nm">{p.name}</td><td>{p.id}</td><td>{p.phone}</td><td>{p.gender} {p.age ? "· " + p.age : ""}</td><td>{p.visits}</td><td>{p.last}</td><td>{p.next}</td></tr>)}</tbody></table>
          {r.history?.length > 0 && (<>
            <div className="title" style={{ margin: "14px 0 6px" }}>Recent procedures · {r.rows[0].name}</div>
            <table className="reg-table"><thead><tr><th>Date</th><th>Procedure</th><th>Part</th><th>Done by</th></tr></thead>
              <tbody>{r.history.map((h, i) => <tr key={i}><td>{h.date}</td><td>{h.proc}</td><td>{h.part}</td><td>{h.by}</td></tr>)}</tbody></table>
          </>)}
        </div>)}
    </div>);
}
