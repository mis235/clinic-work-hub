import { useEffect, useState } from "react";

// Public page (no sign-in): one place to install the two clinic apps, each as its own icon on the phone.
export default function InstallPage() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [evt, setEvt] = useState(null);
  const [how, setHow] = useState(false);
  const [copied, setCopied] = useState("");
  const standalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone);
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const kioskSet = (() => { try { return !!localStorage.getItem("kioskKey"); } catch { return false; } })();

  useEffect(() => {
    const on = (e) => { e.preventDefault(); setEvt(e); };
    window.addEventListener("beforeinstallprompt", on);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);

  const install = async () => {
    if (evt) { evt.prompt(); await evt.userChoice.catch(() => {}); setEvt(null); } else setHow((v) => !v);
  };
  const copy = async (text, key) => { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(""), 2000); } catch {} };

  const card = { background: "#fff", border: "1px solid #e7e1ee", borderRadius: 16, padding: 20, marginBottom: 16 };
  const btn = { border: 0, borderRadius: 10, padding: "12px 16px", fontSize: 15, fontWeight: 700, cursor: "pointer", background: "#C42F8F", color: "#fff" };
  const ghost = { ...btn, background: "#f4eff8", color: "#2a1b3d" };
  return (
    <div style={{ minHeight: "100vh", background: "#FBF3FA", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: "#2a1b3d" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "28px 18px 40px" }}>
        <img src="/logo.png" alt="" style={{ height: 44 }} />
        <h1 style={{ fontSize: 26, margin: "14px 0 4px" }}>Install the clinic apps</h1>
        <p style={{ margin: "0 0 22px", color: "#5b4d6b", lineHeight: 1.5 }}>Two separate apps, each with its own icon on the phone.</p>

        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#C42F8F", letterSpacing: ".04em" }}>FOR EVERY STAFF MEMBER</div>
          <h2 style={{ fontSize: 20, margin: "4px 0 6px" }}>Work Hub</h2>
          <p style={{ margin: "0 0 14px", color: "#5b4d6b", lineHeight: 1.5 }}>Tasks, shift checklist, my attendance, payslips and my documents (offer letter, ID papers). Sign in with your name and PIN.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {!standalone && <button style={btn} onClick={install}>Install Work Hub</button>}
            <a href="/" style={{ ...ghost, textDecoration: "none", display: "inline-block" }}>Open Work Hub</a>
          </div>
          {how && <p style={{ margin: "12px 0 0", fontSize: 13.5, lineHeight: 1.55, color: "#5b4d6b" }}>{ios ? "On iPhone: open this page in Safari, tap Share, then “Add to Home Screen”." : "Tap the 3 dots at the top right of Chrome, then “Install app” or “Add to Home screen”."}</p>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14, alignItems: "center", fontSize: 13 }}>
            <span style={{ color: "#5b4d6b", wordBreak: "break-all" }}>{origin}</span>
            <button style={{ ...ghost, padding: "8px 12px", fontSize: 13 }} onClick={() => copy(origin, "hub")}>{copied === "hub" ? "Copied" : "Copy link"}</button>
            <a style={{ ...ghost, padding: "8px 12px", fontSize: 13, textDecoration: "none" }} href={`https://wa.me/?text=${encodeURIComponent(`Install the clinic Work Hub app: ${origin}/install`)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
          </div>
        </div>

        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#6b4fa0", letterSpacing: ".04em" }}>FOR THE CLINIC PHONE ONLY</div>
          <h2 style={{ fontSize: 20, margin: "4px 0 6px" }}>Check-in (attendance)</h2>
          <p style={{ margin: "0 0 12px", color: "#5b4d6b", lineHeight: 1.5 }}>Staff look at the camera and are marked present. This phone needs a one-time setup link from the admin: Attendance, then Clinic phone, then create the setup link. Open that link on the clinic phone, then tap “Install Check-in app”.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <a href="/kiosk" style={{ ...btn, background: "#2a1b3d", textDecoration: "none", display: "inline-block" }}>Open Check-in</a>
            <span style={{ fontSize: 13, color: kioskSet ? "#176b34" : "#8a5a00", fontWeight: 700 }}>{kioskSet ? "This phone is set up" : "This phone is not set up yet"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
