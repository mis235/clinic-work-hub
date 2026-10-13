import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./theme.css";

// After an app update, drop any old sign-in so nobody is stuck on a stale login ("Invalid or expired token").
try {
  if (localStorage.getItem("buildId") !== __BUILD_ID__) {
    localStorage.removeItem("token"); localStorage.removeItem("user"); // the clinic phone key (kioskKey) is deliberately kept
    localStorage.setItem("buildId", __BUILD_ID__);
  }
} catch {}

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ maxWidth: 480, margin: "80px auto", padding: 24, fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
        <h2>Something went wrong</h2>
        <p style={{ color: "#555" }}>Please reset and sign in again. Your data is safe.</p>
        <button style={{ padding: "12px 20px", fontSize: 15, cursor: "pointer" }}
          onClick={async () => {
            localStorage.clear();
            try { (await navigator.serviceWorker?.getRegistrations())?.forEach((r) => r.unregister()); (await caches.keys()).forEach((k) => caches.delete(k)); } catch {}
            window.location.reload();
          }}>Reset and sign in again</button>
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
