// Small inline icon set (24px grid, 1.8 stroke) — no external icon dependency.
const PATHS = {
  home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>,
  clipboard: <><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v3H9z" /><path d="m9 13 2 2 4-4" /></>,
  tasks: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1.2 1.2L6.8 5M3.5 12l1.2 1.2L6.8 11M3.5 18l1.2 1.2L6.8 17" /></>,
  list: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.8c2 .7 3.4 2.4 3.4 5.2" /></>,
  userplus: <><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20c0-3.4 2.9-5.6 6.5-5.6s6.5 2.2 6.5 5.6" /><path d="M19 8v6M16 11h6" /></>,
  user: <><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6" /></>,
  calendarCheck: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="m9 15 2 2 4-4" /></>,
  wallet: <><path d="M4 7a2 2 0 0 1 2-2h12v4" /><rect x="3.5" y="7" width="17" height="13" rx="2.5" /><circle cx="16.5" cy="13.5" r="1.2" /></>,
  file: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  book: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></>,
  cap: <><path d="m2 9 10-5 10 5-10 5z" /><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5" /></>,
  party: <><path d="m4 20 4.5-12 7.5 7.5z" /><path d="M14 4v2M19 8h2M17 11l1.5-1.5M10 5l1 1.5" /></>,
  bot: <><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 8V4.5M9 13.5v1M15 13.5v1" /><circle cx="12" cy="3.8" r="1" /></>,
  sparkles: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></>,
  building: <><path d="M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16" /><path d="M15 10h3a1 1 0 0 1 1 1v10M3 21h18M9 8h2M9 12h2M9 16h2" /></>,
  shield: <><path d="M12 3 5 6v6c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9V6z" /><path d="m9 12 2 2 4-4" /></>,
  logout: <><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" /><path d="M16 8l4 4-4 4M20 12H9" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  alert: <><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4.5M12 17.2v.3" /></>,
  key: <><circle cx="8" cy="15" r="3.5" /><path d="m10.5 12.5 8-8M15 8l2.5 2.5" /></>,
  eye: <><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  phone: <><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M11 18h2" /></>,
  cake: <><path d="M4 21h16v-7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z" /><path d="M4 16.5c2 1.5 3 1.5 4 0s2-1.5 4 0 3 1.5 4 0 2-1.5 4 0M12 12V9M12 6.2c-1-.9-1-1.8 0-3 1 1.2 1 2.1 0 3z" /></>,
  gift: <><rect x="3.5" y="9" width="17" height="4" rx="1" /><path d="M5 13v8h14v-8M12 9v12" /><path d="M12 9c-2.5 0-4-1-4-2.5S9.5 4 11 5.5 12 9 12 9zm0 0c2.5 0 4-1 4-2.5S14.5 4 13 5.5 12 9 12 9z" /></>,
  trophy: <><path d="M8 4h8v6a4 4 0 0 1-8 0z" /><path d="M8 6H4.5c0 3 1.2 4.5 3.5 5M16 6h3.5c0 3-1.2 4.5-3.5 5M12 14v4M8.5 20h7M10 18h4" /></>,
  star: <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
  quote: <><path d="M10 8H6.5C5.7 8 5 8.7 5 9.5V13c0 .8.7 1.5 1.5 1.5H9c0 2-1 3-3 3.5M19 8h-3.5c-.8 0-1.5.7-1.5 1.5V13c0 .8.7 1.5 1.5 1.5H18c0 2-1 3-3 3.5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>,
  sunset: <><path d="M6.5 16a5.5 5.5 0 0 1 11 0M12 5v3M4.5 9.5 6 11M19.5 9.5 18 11M2.5 16h19M7 20h10" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  pencil: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  send: <><path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z" /></>,
  flag: <><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>,
  play: <><circle cx="12" cy="12" r="8.5" /><path d="m10.2 8.8 5 3.2-5 3.2z" /></>,
  bell: <><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z" /><path d="M10 21h4" /></>,
  chat: <><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9.5h8M8 12.5h5" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.2" /><path d="m6 6 3.8 3.8M18 6l-3.8 3.8M6 18l3.8-3.8M18 18l-3.8-3.8" /></>,
  fingerprint: <><path d="M6 11a6 6 0 0 1 12 0c0 3 .3 5.5 1.5 8M9 20c.8-1.6 1-3.4 1-5.5a2 2 0 0 1 4 0c0 2 .3 3.8 1.2 5.5M4.5 15c.4-1.2.5-2.4.5-4" /></>,
};

export default function Icon({ name, size = 18, className = "", strokeWidth = 1.8 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name] || null}
    </svg>
  );
}

export function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
}
