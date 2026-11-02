// Lumi — the clinic's friendly helper. An original character: a little light-drop with a golden star.
// mood: "idle" | "wave" | "think" | "cheer" | "sorry"
export default function Lumi({ mood = "idle", size = 120, className = "" }) {
  const happy = mood !== "sorry";
  return (
    <svg className={`lumi lumi-${mood} ${className}`} width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Lumi, the clinic helper">
      <defs>
        <radialGradient id="lumiBody" cx="38%" cy="30%" r="80%">
          <stop offset="0" stopColor="#7FE0D2" /><stop offset=".55" stopColor="#1FA597" /><stop offset="1" stopColor="#0B6B63" />
        </radialGradient>
        <radialGradient id="lumiGlow" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#F6E3A3" stopOpacity=".9" /><stop offset="1" stopColor="#F6E3A3" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse className="lumi-shadow" cx="60" cy="110" rx="26" ry="5" fill="#0A2A27" opacity=".18" />
      <g className="lumi-all">
        <circle cx="60" cy="16" r="15" fill="url(#lumiGlow)" className="lumi-halo" />
        <path className="lumi-star" d="M60 6l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z" fill="#E2B84F" />
        <path className="lumi-arm-l" d="M30 70c-9 2-12 10-8 14" stroke="#0B6B63" strokeWidth="7" strokeLinecap="round" fill="none" />
        <path className="lumi-arm-r" d="M90 70c9 2 12 10 8 14" stroke="#0B6B63" strokeWidth="7" strokeLinecap="round" fill="none" />
        <path d="M60 24c20 20 38 38 38 60 0 16-17 26-38 26S22 100 22 84c0-22 18-40 38-60z" fill="url(#lumiBody)" />
        <ellipse cx="46" cy="52" rx="7" ry="11" fill="#fff" opacity=".28" transform="rotate(25 46 52)" />
        <g className="lumi-eyes">
          {happy ? (<>
            <ellipse cx="46" cy="76" rx="6.5" ry="8" fill="#0F2420" /><ellipse cx="74" cy="76" rx="6.5" ry="8" fill="#0F2420" />
            <circle cx="48" cy="73" r="2.4" fill="#fff" /><circle cx="76" cy="73" r="2.4" fill="#fff" />
          </>) : (<>
            <path d="M40 78q6-6 12 0M68 78q6-6 12 0" stroke="#0F2420" strokeWidth="3.4" strokeLinecap="round" fill="none" />
          </>)}
        </g>
        <ellipse cx="37" cy="88" rx="5" ry="3" fill="#F29AA6" opacity=".55" /><ellipse cx="83" cy="88" rx="5" ry="3" fill="#F29AA6" opacity=".55" />
        {mood === "cheer" ? <path d="M52 87q8 11 16 0z" fill="#0F2420" /> : happy ? <path d="M53 88q7 7 14 0" stroke="#0F2420" strokeWidth="3.2" strokeLinecap="round" fill="none" /> : <path d="M54 94q6-5 12 0" stroke="#0F2420" strokeWidth="3.2" strokeLinecap="round" fill="none" />}
      </g>
      {mood === "cheer" && <g className="lumi-sparks" fill="#E2B84F"><path d="M14 40l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /><path d="M104 34l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /><circle cx="22" cy="14" r="3" /><circle cx="100" cy="12" r="3" fill="#7FE0D2" /></g>}
      {mood === "think" && <g className="lumi-dots" fill="#0B6B63"><circle cx="92" cy="28" r="3" /><circle cx="100" cy="20" r="4" /><circle cx="110" cy="10" r="5" /></g>}
    </svg>
  );
}
