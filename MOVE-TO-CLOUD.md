# Moving the Work Hub off the office PC (plain steps)

**Why:** the app and its data live on one PC. If the PC is off, the app is off. If it breaks, data can be lost.
**Goal:** an always-on cloud server with a permanent disk, plus automatic backups kept somewhere else.

## Today (free): protect the data
System & Backups → **Safe copy outside this app** → point it at a Google Drive for desktop folder.
Every night the database and all photos/files are copied there. Also check **Storage** monthly.

## When you are ready for the cloud (about ₹700–1,500 a month — check current prices)
1. Follow `DEPLOY.md` (GitHub → Render Blueprint). `render.yaml` already asks for a 10 GB permanent disk at `/var/data`
   (`DATA_DIR`). The database, uploads, photos, payslips and nightly backups all live on that disk.
2. Move today's data across: stop the app on the PC; take the newest file from `backend/backups` (or `clinic.db`) plus the
   folders `backend/uploads`, `backend/private`, `backend/payslips`; Claude will add a one-time "Restore" step for this —
   ask when you are about to switch.
3. Keep **Safe copy** going with an off-site place the server can reach (Claude can add Google Drive / S3 upload for the
   cloud server — ask when you switch), so backups are never only on the same server.
4. Switch the clinic phone's kiosk link to the new https address (no certificate warning there).

## Not recommended (yet): full Postgres database
It would need most of the app's data code rewritten. A single SQLite file on a cloud disk with off-site backups is more than
enough for a clinic of this size (tens of staff, millions of rows possible).
