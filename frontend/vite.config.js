import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify(String(Date.now())) }, // changes on every build so old logins are cleared after an update
  server: { port: 5173 },
});
