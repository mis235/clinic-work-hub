#!/usr/bin/env bash
# Set a new admin password (no login needed).  Usage: bash reset-admin.sh "NewPassword123"
docker exec clinic-hub node reset-admin-password.mjs "$1"
