#!/usr/bin/env bash
# Connect Lumi to the n8n chat link (no login needed).  Usage: bash set-lumi-link.sh "https://…/webhook/…/chat"
docker exec clinic-hub node set-lumi-link.mjs "$1"
