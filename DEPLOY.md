# Put the Work Hub online (Render) — step by step

Result: one https link (e.g. https://clinic-work-hub.onrender.com) that works on every phone and laptop.
Cost: Render "Starter" web service ≈ US$7/month (needed so the database and photos are not erased).

## A. Put the code on GitHub (once)
1. Create a free account at github.com → New repository → name `clinic-work-hub` → **Private** → Create.
2. On the new repo page click **uploading an existing file**, drag in everything from the unzipped
   folder (backend, frontend, render.yaml, .gitignore, DEPLOY.md …) → **Commit changes**.
   (node_modules / .env are not in the zip, so nothing secret is uploaded.)

## B. Deploy on Render
1. Create an account at render.com → sign in with GitHub.
2. **New + → Blueprint** → pick `clinic-work-hub` → Render reads `render.yaml`.
3. It asks for **ADMIN_PASSWORD** — type a strong password (this is the admin login). Leave the others blank for now → **Apply**.
4. Wait ~5 minutes for "Live". Open the link shown at the top (https://….onrender.com).

## C. One more setting (for fingerprint attendance)
Render → your service → **Environment**:
- WEBAUTHN_RP_ID = `clinic-work-hub.onrender.com` (your link without https://)
- WEBAUTHN_ORIGIN = `https://clinic-work-hub.onrender.com`
Save → it redeploys.

## D. Log in
- Admin: admin@drnishitaranka.com + the password you chose.
- Staff: "Staff (PIN)" tab, name + starter PIN 1234. Everyone is forced to choose their own PIN at first sign-in. If someone forgets it: Staff Onboarding → key icon → set a temporary PIN.

## Editing later
Change code (with Claude) → upload the changed files to GitHub → Render redeploys automatically.
Data (tasks, submissions, photos) lives on the Render disk and survives redeploys.

## Later: turning it into a phone app
The site is already a PWA: on the phone open the link → browser menu → **Add to Home Screen**.
A Play Store / App Store version can wrap this same link afterwards.

## Notes
- Free plan works for a quick look only: it sleeps when idle and **erases data** on restart.
- Back up: Render → Disk → Snapshots, or ask Claude to add a "Download backup" button.

---

## Safety features (built in)

- **Login lockout:** 6 wrong attempts for the same person locks sign-in for 15 minutes.
- **Backups:** the database is backed up automatically every night at 2 am into `/var/data/backups` (last 14 kept). Admins can also press **Back up now** in *System & Activity*.
- **Activity log:** every change made by a signed-in person is recorded (who, what, when). See *System & Activity*.
- **Health check:** `https://YOUR-APP/health` shows `{"ok":true,"db":"ok"}` when everything is fine. Render uses this address to restart the app if it breaks.
- **Start-up check:** the server refuses to start if `JWT_SECRET` is missing, with a clear message.
- **Self-test:** `cd backend && npm test` runs 23 checks on a throwaway database and prints PASS/FAIL.

## Never upload `backend/.env`
That file holds your passwords and WhatsApp keys. It is already excluded from the zip and from Git. Set the same values in Render's *Environment* tab instead.
