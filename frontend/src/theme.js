// Lavender is the default; Peach and mint is the second look. The choice is remembered on this device.
export const getTheme = () => { try { return localStorage.getItem("theme") === "peach" ? "peach" : "lavender"; } catch { return "lavender"; } };
export const setTheme = (t) => { try { localStorage.setItem("theme", t); } catch {} document.documentElement.dataset.theme = t; };
export const applyTheme = () => { document.documentElement.dataset.theme = getTheme(); };
