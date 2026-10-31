#!/usr/bin/env bash
# Update the Work Hub to the newest version. Backs up the data first.
# Public repo:   bash update-server.sh        Private repo:   GH_TOKEN=xxxx bash update-server.sh
set -euo pipefail
cd /docker/clinic-work-hub
cp -a data "data-backup-$(date +%Y%m%d-%H%M)"
(cd src && git pull "https://${GH_TOKEN:+x-access-token:${GH_TOKEN}@}github.com/mis235/clinic-work-hub.git" && cd deploy && docker compose up -d --build)
echo "Updated."
