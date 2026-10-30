# Work Hub for the cloud server. Built once on the server; data lives outside the image (in /data).
FROM node:20-bookworm-slim AS build
WORKDIR /app
# build tools: better-sqlite3 has no ready-made file for this Node version, so it is compiled
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY backend/package*.json backend/
RUN cd backend && npm ci --omit=dev --no-audit --no-fund
COPY frontend/package*.json frontend/
RUN cd frontend && npm ci --no-audit --no-fund
COPY frontend frontend
RUN cd frontend && npm run build

FROM node:20-bookworm-slim
ENV NODE_ENV=production PORT=4000 DATA_DIR=/data DOTENV_CONFIG_PATH=/data/.env NO_HTTPS=1 TZ=Asia/Kolkata
WORKDIR /app
COPY --from=build /app/backend/node_modules backend/node_modules
COPY backend backend
COPY --from=build /app/frontend/dist frontend/dist
WORKDIR /app/backend
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
