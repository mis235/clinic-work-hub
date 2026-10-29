#!/usr/bin/env bash
# One-time install of the Work Hub on the clinic server, next to n8n. Does NOT touch n8n or Traefik.
# Usage (in the server's black window):   GH_TOKEN=xxxx bash install-server.sh
set -euo pipefail
DOMAIN="${DOMAIN:-staff.drnishitaranka.com}"
REPO="${REPO:-mis235/clinic-work-hub}"
DIR=/docker/clinic-work-hub
[ -n "${GH_TOKEN:-}" ] || { echo "Missing GH_TOKEN. Run:  GH_TOKEN=your-token bash install-server.sh"; exit 1; }
command -v git >/dev/null || apt-get install -y git
mkdir -p "$DIR" && cd "$DIR"
if [ ! -d src/.git ]; then git clone "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git" src; else (cd src && git pull "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"); fi
(cd src && git remote set-url origin "https://github.com/${REPO}.git")   # the token is not kept on the server
mkdir -p data
if [ ! -f data/.env ]; then
  PASS=$(head -c 9 /dev/urandom | base64 | tr -d '/+=' | head -c 12)
  cat > data/.env <<ENV
PORT=4000
JWT_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
ADMIN_EMAIL=admin@drnishitaranka.com
ADMIN_PASSWORD=${PASS}
WEBAUTHN_RP_ID=${DOMAIN}
WEBAUTHN_RP_NAME=Dr. Nishita's Clinic
WEBAUTHN_ORIGIN=https://${DOMAIN}
ENV
  chmod 600 data/.env
  echo "First admin password: ${PASS}   (change it in the app: System & Backups -> Change my password)"
fi
cd src/deploy
echo "DOMAIN=${DOMAIN}" > .env
docker compose up -d --build
echo; echo "Done. Open https://${DOMAIN} in a few minutes (after the DNS record exists)."
