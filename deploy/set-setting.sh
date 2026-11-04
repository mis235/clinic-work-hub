#!/usr/bin/env bash
# bash set-setting.sh sheet "<Google Sheet link>"
# bash set-setting.sh push "<Apps Script /exec link>" "<secret word>"
docker exec clinic-hub node set-setting.mjs "$@"
