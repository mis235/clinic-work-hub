#!/usr/bin/env bash
# bash set-setting.sh sheet "<Google Sheet link>"
# bash set-setting.sh push "<Apps Script /exec link>" "<secret word>"
# bash set-setting.sh rooms "<n8n webhook link>"
docker exec clinic-hub node set-setting.mjs "$@"
