#!/usr/bin/env bash
# Update the Work Hub to the newest version. Backs up the data first. Usage:  GH_TOKEN=xxxx bash update-server.sh
set -euo pipefail
cd /docker/clinic-work-hub
[ -n "${GH_TOKEN:-}" ] || { echo "Missing GH_TOKEN"; exit 1; }
cp -a data "data-backup-$(date +%Y%m%d-%H%M)"
(cd src && git pull "https://x-access-token:${GH_TOKEN}@github.com/mis235/clinic-work-hub.git" && cd deploy && docker compose up -d --build)
echo "Updated."
