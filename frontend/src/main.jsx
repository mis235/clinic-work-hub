import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./theme.css";

// Stay signed in across updates and reopen. (An old version wiped the sign-in after every update; that is gone.)
// If a saved sign-in is ever truly invalid, the server says so (401) and the app asks to sign in once.
try { localStorage.setItem("buildId", __BUILD_ID__); navigator.storage?.persist?.(); } catch {}

// When someone returns to the app (phone unlocked, tab reopened), every live screen refreshes at once.
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") window.dispatchEvent(new Event("hub-refresh")); });
window.addEventListener("online", () => window.dispatchEvent(new Event("hub-refresh")));

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ maxWidth: 480, margin: "80px auto", padding: 24, fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
        <h2>Something Went Wrong</h2>
        <p style={{ color: "#555" }}>Please reset the app. You stay signed in and your data is safe.</p>
        <button style={{ padding: "12px 20px", fontSize: 15, cursor: "pointer" }}
          onClick={async () => {
            try { localStorage.removeItem("buildId"); } catch {}
            try { (await navigator.serviceWorker?.getRegistrations())?.forEach((r) => r.unregister()); (await caches.keys()).forEach((k) => caches.delete(k)); } catch {}
            window.location.reload();
          }}>Reset the app</button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-fatal: app still works as a normal responsive web app without PWA install/offline support.
    });
  });
}
