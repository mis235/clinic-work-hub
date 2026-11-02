import Lumi from "./Lumi.jsx";

// "Hello — how can I support you today?" bar on the home screens. Opens the Lumi chat in the corner.
export default function AskLumiBar() {
  return (
    <button className="ask-lumi" onClick={() => window.dispatchEvent(new CustomEvent("lumi-open"))} aria-label="Ask Lumi">
      <Lumi mood="idle" size={34} />
      <span>Ask Lumi anything about your work…</span>
      <b>→</b>
    </button>
  );
}
