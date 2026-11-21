import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Buddy from "../components/Buddy.jsx";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";

const fmtSize = (n) => (!n ? "—" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtDate = (d) => { try { return new Date(String(d).replace(" ", "T") + "Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Calcutta" }); } catch { return ""; } };
const ext = (n) => (String(n).split(".").pop() || "").toLowerCase();
const FolderIcon = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="#8f73d6"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
const KIND = { pdf: ["#d64545", "PDF"], docx: ["#3b6fd6", "DOC"], doc: ["#3b6fd6", "DOC"], xlsx: ["#2e9b5f", "XLS"], xls: ["#2e9b5f", "XLS"], csv: ["#2e9b5f", "CSV"], pptx: ["#d9792b", "PPT"], png: ["#a259c9", "IMG"], jpg: ["#a259c9", "IMG"], jpeg: ["#a259c9", "IMG"], webp: ["#a259c9", "IMG"] };
const FileIcon = ({ name }) => { const [c, t] = KIND[ext(name)] || ["#7b7f93", "FILE"]; return <span className="lib-badge" style={{ background: c }}>{t}</span>; };
const viewable = (n) => ["pdf", "png", "jpg", "jpeg", "webp", "docx", "txt", "csv"].includes(ext(n));

export default function LibraryPage({ user, isStaffLayout, onLogout, onBack }) {
  const [folder, setFolder] = useState(null), [data, setData] = useState(null), [err, setErr] = useState(""), [note, setNote] = useState(""), [busy, setBusy] = useState(false);
  const [access, setAccess] = useState(null), [menu, setMenu] = useState(null), [view, setView] = useState(null), [drag, setDrag] = useState(false), [mobileOpen, setMobileOpen] = useState(false);
  const fileIn = useRef(null), zipIn = useRef(null), replaceIn = useRef(null), replaceId = useRef(null);

  const load = (id = folder) => api.libraryList(id).then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => { load(folder); setMenu(null); }, [folder]);
  useEffect(() => { const c = () => setMenu(null); window.addEventListener("click", c); return () => window.removeEventListener("click", c); }, []);

  async function run(fn, done) { setBusy(true); setErr(""); setNote(""); try { const r = await fn(); if (done) setNote(done(r)); await load(); } catch (e) { setErr(/50[234]/.test(e.message) ? "The server was busy or restarting. Wait a minute, refresh the page, and check whether the files arrived before trying again." : e.message); } setBusy(false); }
  const upload = (files) => { if (!files?.length) return; const fd = new FormData(); fd.append("folderId", folder || ""); [...files].forEach((f) => fd.append("files", f)); return run(() => api.libraryUpload(fd), (r) => `${r.added} added${r.replaced ? `, ${r.replaced} replaced` : ""}.`); };
  const importZip = (f) => { if (!f) return; const fd = new FormData(); fd.append("folderId", folder || ""); fd.append("file", f); return run(() => api.libraryImport(fd), (r) => `${r.files} files added${r.replaced ? `, ${r.replaced} replaced` : ""}, ${r.folders} new folders.`); };
  const newLink = () => { const name = window.prompt("Name of the link (for example: Cleaning video)"); if (!name?.trim()) return; const url = window.prompt("Paste the link (starts with https://)"); if (url?.trim()) run(() => api.libraryNewLink({ folderId: folder, name: name.trim(), url: url.trim() })); };
  const setup = () => { if (window.confirm("Add the recommended folders (Therapist, Front Desk, Pharmacy, Clinic Documentation and so on)? Nothing existing is moved or deleted.")) run(() => api.librarySetup(), (r) => r.created ? `${r.created} folders added.` : "All recommended folders are already here."); };
  const newFolder = () => { const name = window.prompt("Folder name"); if (name?.trim()) run(() => api.libraryNewFolder(folder, name.trim())); };
  const renameFolder = (f) => { const name = window.prompt("Folder name", f.name); if (name?.trim() && name.trim() !== f.name) run(() => api.libraryRenameFolder(f.id, name.trim())); };
  const delFolder = (f) => { if (window.confirm(`Delete the folder "${f.name}" and everything inside it? This cannot be undone.`)) run(() => api.libraryDeleteFolder(f.id)); };
  const renameFile = (f) => { const name = window.prompt("File name", f.name); if (name?.trim() && name.trim() !== f.name) run(() => api.libraryRenameFile(f.id, { name: name.trim() })); };
  const delFile = (f) => { if (window.confirm(`Delete "${f.name}"? This cannot be undone.`)) run(() => api.libraryDeleteFile(f.id)); };
  const replaceFile = (file) => { if (!file || !replaceId.current) return; const fd = new FormData(); fd.append("file", file); run(() => api.libraryReplaceFile(replaceId.current, fd), () => "File replaced."); };

  async function open(f) {
    const e = ext(f.name);
    if (f.url) return window.open(f.url, "_blank", "noopener");
    if (!viewable(f.name)) return api.downloadLibraryFile(f.id, f.name).catch((x) => setErr(x.message));
    setView({ f, loading: true });
    try {
      if (e === "docx" || e === "txt" || e === "csv") setView({ f, ...(await api.libraryPreview(f.id)) });
      else setView({ f, url: await api.libraryBlobUrl(f.id), img: e !== "pdf" });
    } catch (x) { setView(null); setErr(x.message); }
  }

  const items = (data?.folders.length || 0) + (data?.files.length || 0);
  const body = (
    <div className={"lib" + (drag ? " drag" : "")}
      onDragOver={(e) => { if (data?.canManage) { e.preventDefault(); setDrag(true); } }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { setDrag(false); if (data?.canManage) { e.preventDefault(); upload(e.dataTransfer.files); } }}>
      <input ref={fileIn} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
      <input ref={zipIn} type="file" accept=".zip" hidden onChange={(e) => { importZip(e.target.files[0]); e.target.value = ""; }} />
      <input ref={replaceIn} type="file" hidden onChange={(e) => { replaceFile(e.target.files[0]); e.target.value = ""; }} />

      <div className="lib-guide">
        <Buddy mood={err ? "confused" : busy ? "working" : note ? "success" : data && items === 0 ? "thinking" : "welcome"} size={60} />
        <div>
          <b>{err ? "That did not work" : busy ? "Working on it…" : note ? "Done" : !folder ? "Welcome to the Library" : data?.path.at(-1)?.name}</b>
          <span>{err ? "Read the message below and try again." : busy ? "Please keep this page open." : note || (data?.canManage ? "Open a folder, or upload files and folders here." : "Open a folder to read or download. Everything here is for your work.")}</span>
        </div>
      </div>
      <div className="lib-bar">
        <nav className="lib-crumbs">
          <button onClick={() => setFolder(null)} className={!folder ? "cur" : ""}>Library</button>
          {data?.path.map((p, i) => <span key={p.id}><i>/</i><button onClick={() => setFolder(p.id)} className={i === data.path.length - 1 ? "cur" : ""}>{p.name}</button></span>)}
        </nav>
        {data?.canManage && (
          <div className="lib-tools">
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={newFolder}>New folder</button>
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={newLink}>Add link</button>
            {!folder && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={setup}>Add recommended folders</button>}
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => fileIn.current.click()}>{busy ? "Working…" : "Upload files"}</button>
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => zipIn.current.click()}>Upload folder (.zip)</button>
          </div>)}
      </div>
      {err && <div className="login-error" style={{ marginBottom: 10 }}>{err}</div>}

      <div className="lib-table">
        <div className="lib-row lib-head"><span>Name</span><span className="c-date">Modified</span><span className="c-size">Size</span><span /></div>
        {!data && !err && <div className="lib-empty">Loading…</div>}
        {data && items === 0 && <div className="lib-empty"><Buddy mood="thinking" size={84} style={{ margin: "0 auto 10px" }} />This folder is empty.{data.canManage && " Drop files here, or use Upload files."}</div>}
        {data?.folders.map((f) => (
          <div key={f.id} className="lib-row" onClick={() => setFolder(f.id)}>
            <span className="lib-name"><FolderIcon /><b>{f.name}</b><em>{f.items} item{f.items === 1 ? "" : "s"}</em>{(f.admin_only || f.dept_name) && <span className="lib-lock">{f.admin_only ? "Admin only" : f.dept_name + " only"}</span>}</span>
            <span className="c-date">{fmtDate(f.created_at)}</span><span className="c-size">—</span>
            <span className="lib-act" onClick={(e) => e.stopPropagation()}>
              {data.canManage && <Kebab id={"d" + f.id} menu={menu} setMenu={setMenu} items={[["Rename", () => renameFolder(f)], ["Who can see it", () => setAccess({ f, value: f.admin_only ? "admin" : f.dept_id || "all" })], ["Delete", () => delFolder(f)]]} />}
            </span>
          </div>))}
        {data?.files.map((f) => (
          <div key={f.id} className="lib-row" onClick={() => open(f)}>
            <span className="lib-name">{f.url ? <span className="lib-badge" style={{ background: "#2f8f9d" }}>LINK</span> : <FileIcon name={f.name} />}<b>{f.name}</b></span>
            <span className="c-date">{fmtDate(f.updated_at)}</span><span className="c-size">{f.url ? "Link" : fmtSize(f.size)}</span>
            <span className="lib-act" onClick={(e) => e.stopPropagation()}>
              {f.url ? <a className="btn btn-ghost btn-sm" href={f.url} target="_blank" rel="noreferrer">Open</a> : <button className="btn btn-ghost btn-sm" onClick={() => api.downloadLibraryFile(f.id, f.name).catch((x) => setErr(x.message))}>Download</button>}
              {data.canManage && <Kebab id={"f" + f.id} menu={menu} setMenu={setMenu} items={f.url ? [["Rename", () => renameFile(f)], ["Delete", () => delFile(f)]] : [["Rename", () => renameFile(f)], ["Replace file", () => { replaceId.current = f.id; replaceIn.current.click(); }], ["Delete", () => delFile(f)]]} />}
            </span>
          </div>))}
      </div>

      {access && createPortal(
        <div className="lib-modal" onClick={() => setAccess(null)}>
          <div className="lib-sheet" style={{ height: "auto", width: "min(440px, 100%)" }} onClick={(e) => e.stopPropagation()}>
            <div className="lib-sheet-head"><b>Who can see "{access.f.name}"?</b></div>
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "flex", gap: 8 }}><input type="radio" checked={access.value === "all"} onChange={() => setAccess({ ...access, value: "all" })} />Everyone</label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="radio" checked={access.value !== "all" && access.value !== "admin"} onChange={() => setAccess({ ...access, value: data.departments[0]?.id || "all" })} />Only one department
                <select className="field" style={{ maxWidth: 200 }} value={access.value !== "all" && access.value !== "admin" ? access.value : ""} onChange={(e) => e.target.value && setAccess({ ...access, value: e.target.value })}><option value="">Choose…</option>{data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              <label style={{ display: "flex", gap: 8 }}><input type="radio" checked={access.value === "admin"} onChange={() => setAccess({ ...access, value: "admin" })} />Admin only</label>
              <div className="meta">Managers and the admin can always open department folders. Everything inside the folder follows this setting.</div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setAccess(null)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={() => { const a = access; setAccess(null); run(() => api.libraryAccess(a.f.id, a.value), () => "Saved."); }}>Save</button>
              </div>
            </div>
          </div>
        </div>, document.body)}
      {view && createPortal(
        <div className="lib-modal" onClick={() => { if (view.url) URL.revokeObjectURL(view.url); setView(null); }}>
          <div className="lib-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="lib-sheet-head"><b>{view.f.name}</b>
              <span><button className="btn btn-outline btn-sm" onClick={() => api.downloadLibraryFile(view.f.id, view.f.name)}>Download</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { if (view.url) URL.revokeObjectURL(view.url); setView(null); }}>Close</button></span></div>
            <div className="lib-sheet-body">
              {view.loading && <div className="lib-empty">Opening…</div>}
              {view.html != null && <div className="lib-doc" dangerouslySetInnerHTML={{ __html: view.html }} />}
              {view.text != null && <pre className="lib-doc" style={{ whiteSpace: "pre-wrap" }}>{view.text}</pre>}
              {view.url && (view.img ? <img src={view.url} alt="" style={{ maxWidth: "100%" }} /> : <iframe title={view.f.name} src={view.url} style={{ width: "100%", height: "100%", border: 0 }} />)}
            </div>
          </div>
        </div>, document.body)}
    </div>
  );

  if (isStaffLayout) return <div style={{ marginTop: 8 }}>{body}</div>;
  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="SOPs" onSelect={(item) => item !== "SOPs" && onBack(item)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`} onLogout={onLogout} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="main"><MobileTopBar title="SOPs" onOpenMenu={() => setMobileOpen(true)} />{body}</div>
    </div>
  );
}

function Kebab({ id, menu, setMenu, items }) {
  return (
    <span style={{ position: "relative" }}>
      <button className="btn btn-ghost btn-sm" aria-label="More" onClick={(e) => { e.stopPropagation(); setMenu(menu === id ? null : id); }}>⋯</button>
      {menu === id && <div className="lib-menu">{items.map(([l, fn]) => <button key={l} onClick={(e) => { e.stopPropagation(); setMenu(null); fn(); }}>{l}</button>)}</div>}
    </span>
  );
}
