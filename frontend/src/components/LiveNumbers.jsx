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

export default function LiveNumbers({ user }) {
  const [d, setD] = useState(null), [cfg, setCfg] = useState(null), [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [open, setOpen] = useState(false);
  const load = () => api.liveNumbers().then(setD).catch((e) => setMsg(e.message));
  const loadCfg = () => user.role === "admin" && api.liveConfig().then((c) => { setCfg(c); setUrl(c.url || ""); }).catch(() => {});
  useEffect(() => { load(); loadCfg(); const t = setInterval(load, 60000); window.addEventListener("hub-refresh", load); return () => { clearInterval(t); window.removeEventListener("hub-refresh", load); }; }, []);
  const x = d?.data, isAdmin = user.role === "admin";
  const copy = (t) => { navigator.clipboard?.writeText(t); setMsg("Copied."); };
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {isAdmin && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div className="meta">{d?.status || "Not connected yet."} {x?.updatedAt ? `· numbers as of ${x.updatedAt}` : ""}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-outline btn-sm" disabled={busy || !cfg?.url} onClick={async () => { setBusy(true); setMsg(""); try { await api.refreshLive(); await load(); await loadCfg(); setMsg("Updated."); } catch (e) { setMsg(e.message); } setBusy(false); }}>{busy ? "Reading sheets…" : "Update now"}</button>
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

      {!x && <div className="empty">{d?.configured ? "Waiting for the first update (up to 10 minutes). Admin can press Update now." : "Live numbers are not connected yet. Ask the admin to finish the setup."}</div>}
      {x && Object.keys(x.errors || {}).length > 0 && <div className="card meta">Some sheets could not be read: {Object.entries(x.errors).map(([k, v]) => `${k} (${v})`).join(" · ")}</div>}

      {x?.revenue && (<>
        <div className="kpi-row">
          <Kpi l={`Sales · ${mon(x.revenue.focus)}`} v={rs(x.revenue.thisMonth)} c={GREEN} sub={`${x.revenue.invoices} invoices`} />
          <Kpi l="Received" v={rs(x.revenue.paid)} c={GREEN} />
          <Kpi l="Pending this month" v={rs(x.revenue.pending)} c={GOLD} />
          <Kpi l="Pending, all months" v={rs(x.revenue.pendingAll)} c="#d4432a" />
        </div>
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Sales by month" sub="Invoice total"><Columns items={x.revenue.byMonth} val={(r) => r.total} label={(r) => mon(r.m)} color={GREEN} fmt={(n) => (n >= 100000 ? (n / 100000).toFixed(1) + "L" : Math.round(n / 1000) + "k")} /></Card>
          <Card t={`Sales by category · ${mon(x.revenue.focus)}`}><Bars items={x.revenue.byCategory} fmt={rs} color={GREEN} /></Card>
        </div>
      </>)}

      {x?.procedures && (<>
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

      {x?.suggested && (<>
        <div className="kpi-row">
          <Kpi l="Suggested (this year)" v={x.suggested.total} />
          <Kpi l="Done" v={x.suggested.done} c={GREEN} />
          <Kpi l="Still pending" v={x.suggested.pending} c={GOLD} />
          <Kpi l="Done rate" v={x.suggested.rate + "%"} c={GREEN} />
        </div>
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Suggested vs done by month" sub="Done rate %"><Columns items={x.suggested.byMonth} val={(r) => (r.sug ? Math.round((r.done / r.sug) * 100) : 0)} label={(r) => mon(r.m)} color={GREEN} fmt={(n) => n + "%"} /></Card>
          <Card t="By category" sub="Done of suggested"><Bars items={x.suggested.byCategory} val={(r) => r.sug} fmt={(n) => n} label={(r) => `${r.k} (${r.done} done)`} color={GOLD} /></Card>
        </div>
      </>)}

      {x?.leads && (<>
        <div className="kpi-row"><Kpi l="Leads (TeleCRM)" v={x.leads.total} /></div>
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Leads, last 14 days"><Columns items={x.leads.last14} val={(r) => r.n} label={(r) => r.d.slice(8)} /></Card>
          <Card t="By status"><Bars items={x.leads.byStatus} /></Card>
          <Card t="By source"><Bars items={x.leads.bySource} color={GOLD} /></Card>
          <Card t="By stage"><Bars items={x.leads.byStage} color={GREEN} /></Card>
        </div>
      </>)}
    </div>);
}
