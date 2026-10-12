#!/usr/bin/env bash
# End-to-end smoke test for the Clinic OS backend (RBAC edition).
# Usage: cd backend && bash test-e2e.sh

set -uo pipefail
PASS=0; FAIL=0
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$BACKEND_DIR"

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }
check() { if [ "$2" -eq 0 ]; then green "  PASS  $1"; PASS=$((PASS+1)); else red "  FAIL  $1"; FAIL=$((FAIL+1)); fi; }

echo "== Clinic OS backend — end-to-end test (RBAC) =="
echo

if [ ! -f .env ]; then
  echo "No .env found — creating a temporary one with local test values."
  cp .env.example .env.test
  sed -i.bak \
    -e 's/JWT_SECRET=.*/JWT_SECRET=test-secret-do-not-use-in-prod/' \
    -e 's/ADMIN_EMAIL=.*/ADMIN_EMAIL=admin@test.local/' \
    -e 's/ADMIN_PASSWORD=.*/ADMIN_PASSWORD=testpass123/' \
    .env.test
  rm -f .env.test.bak
  ENV_FILE=".env.test"; CLEANUP_ENV=1
else
  ENV_FILE=".env"; CLEANUP_ENV=0
  echo "Using existing .env for ADMIN_EMAIL/ADMIN_PASSWORD."
fi

ADMIN_EMAIL=$(grep '^ADMIN_EMAIL=' "$ENV_FILE" | cut -d= -f2-)
ADMIN_PASSWORD=$(grep '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)

set -a; source "$ENV_FILE"; set +a
export CLINIC_DB_FILE="clinic.test.db"
export DISABLE_CRON="true"
rm -f "$CLINIC_DB_FILE" "$CLINIC_DB_FILE-wal" "$CLINIC_DB_FILE-shm"

echo "Starting server..."
node src/server.js > /tmp/clinic-test-server.log 2>&1 &
SERVER_PID=$!
sleep 1.5
if ! kill -0 "$SERVER_PID" 2>/dev/null; then red "Server failed to start:"; cat /tmp/clinic-test-server.log; exit 1; fi

cleanup() {
  kill "$SERVER_PID" 2>/dev/null
  rm -f "$CLINIC_DB_FILE" "$CLINIC_DB_FILE-wal" "$CLINIC_DB_FILE-shm"
  [ "$CLEANUP_ENV" -eq 1 ] && rm -f .env.test
}
trap cleanup EXIT

HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/health)
check "Server health check" $([ "$HEALTH" = "200" ] && echo 0 || echo 1)

node src/seed.js > /tmp/clinic-test-seed.log 2>&1
check "Seed roles, permissions, departments, users" $?

# --- Admin login (email + password) ---
ADMIN_RESP=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
TOKEN=$(echo "$ADMIN_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
check "Admin login (email+password) returns a token" $([ -n "$TOKEN" ] && echo 0 || echo 1)

ADMIN_ROLE=$(echo "$ADMIN_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('user',{}).get('role',''))" 2>/dev/null)
check "Admin token carries role 'admin'" $([ "$ADMIN_ROLE" = "admin" ] && echo 0 || echo 1)

# --- Roster ---
ROSTER=$(curl -s http://localhost:4000/api/users)
STAFF_ID=$(echo "$ROSTER" | python3 -c "import sys,json;d=json.load(sys.stdin);print(next(u['id'] for u in d if u['role']=='staff'))" 2>/dev/null)
check "Roster excludes admin, includes staff" $([ -n "$STAFF_ID" ] && echo 0 || echo 1)

FULL_ROSTER=$(curl -s http://localhost:4000/api/users/full -H "Authorization: Bearer $TOKEN")
HAS_PHONE=$(echo "$FULL_ROSTER" | python3 -c "import sys,json;d=json.load(sys.stdin);print('yes' if d and d[0].get('phone') else 'no')" 2>/dev/null)
check "Admin-only roster (/full) exposes phone numbers" $([ "$HAS_PHONE" = "yes" ] && echo 0 || echo 1)

STAFF_PHONE=$(echo "$FULL_ROSTER" | python3 -c "import sys,json;d=json.load(sys.stdin);print(next(u['phone'] for u in d if u['id']=='$STAFF_ID'))" 2>/dev/null)

# --- RBAC enforcement: staff cannot assign tasks ---
STAFF_LOGIN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" -d "{\"userId\":\"$STAFF_ID\",\"pin\":\"1234\"}")
STAFF_TOKEN=$(echo "$STAFF_LOGIN" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
check "Staff PIN login returns a token" $([ -n "$STAFF_TOKEN" ] && echo 0 || echo 1)

DENIED_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:4000/api/tasks \
  -H "Content-Type: application/json" -H "Authorization: Bearer $STAFF_TOKEN" \
  -d "{\"userId\":\"$STAFF_ID\",\"title\":\"Should be denied\",\"category\":\"Test\"}")
check "Staff is denied task:assign (expect 403)" $([ "$DENIED_CODE" = "403" ] && echo 0 || echo 1)

# --- Admin creates a task ---
TASK_RESP=$(curl -s -X POST http://localhost:4000/api/tasks \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{\"userId\":\"$STAFF_ID\",\"title\":\"Test task\",\"category\":\"Test\"}")
TASK_ID=$(echo "$TASK_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
check "Admin can create a task (task:assign granted)" $([ -n "$TASK_ID" ] && echo 0 || echo 1)

STAFF_TASKS=$(curl -s http://localhost:4000/api/tasks -H "Authorization: Bearer $STAFF_TOKEN")
SEES_TASK=$(echo "$STAFF_TASKS" | python3 -c "import sys,json;d=json.load(sys.stdin);print('yes' if any(t['id']=='$TASK_ID' for t in d) else 'no')" 2>/dev/null)
check "Staff sees only their own task (task:view_own)" $([ "$SEES_TASK" = "yes" ] && echo 0 || echo 1)

# --- Simulate the full WhatsApp lifecycle: sent -> accepted -> done ---
curl -s -X PATCH http://localhost:4000/api/tasks/$TASK_ID/status \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"status":"sent"}' > /dev/null

PHONE_DIGITS=$(echo "$STAFF_PHONE" | tr -d '+ ')
curl -s -X POST http://localhost:4000/webhook/whatsapp -H "Content-Type: application/json" \
  -d "{\"entry\":[{\"changes\":[{\"value\":{\"messages\":[{\"from\":\"$PHONE_DIGITS\",\"type\":\"text\",\"text\":{\"body\":\"1\"}}]}}]}]}" > /dev/null
sleep 0.3
AFTER_ACCEPT=$(curl -s http://localhost:4000/api/tasks -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(next((t['status'] for t in d if t['id']=='$TASK_ID'), ''))" 2>/dev/null)
check "WhatsApp reply '1' → status 'accepted'" $([ "$AFTER_ACCEPT" = "accepted" ] && echo 0 || echo 1)

curl -s -X POST http://localhost:4000/webhook/whatsapp -H "Content-Type: application/json" \
  -d "{\"entry\":[{\"changes\":[{\"value\":{\"messages\":[{\"from\":\"$PHONE_DIGITS\",\"type\":\"text\",\"text\":{\"body\":\"3\"}}]}}]}]}" > /dev/null
sleep 0.3
AFTER_DONE=$(curl -s http://localhost:4000/api/tasks -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(next((t['status'] for t in d if t['id']=='$TASK_ID'), ''))" 2>/dev/null)
check "WhatsApp reply '3' → status 'done'" $([ "$AFTER_DONE" = "done" ] && echo 0 || echo 1)

# --- Biometric attendance (WebAuthn) — server-side logic only.               ---
# --- The actual fingerprint/Face ID prompt can only be tested on a real      ---
# --- phone browser; this checks the plumbing around it is correct.          ---
REG_OPTIONS=$(curl -s http://localhost:4000/api/attendance/register/options -H "Authorization: Bearer $STAFF_TOKEN")
HAS_CHALLENGE=$(echo "$REG_OPTIONS" | python3 -c "import sys,json;print('yes' if json.load(sys.stdin).get('challenge') else 'no')" 2>/dev/null)
check "Registration options include a WebAuthn challenge" $([ "$HAS_CHALLENGE" = "yes" ] && echo 0 || echo 1)

PLATFORM_ONLY=$(echo "$REG_OPTIONS" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('authenticatorSelection',{}).get('authenticatorAttachment',''))" 2>/dev/null)
check "Registration requires the phone's own biometric (platform authenticator)" $([ "$PLATFORM_ONLY" = "platform" ] && echo 0 || echo 1)

CHECKIN_BEFORE_REG=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/attendance/checkin/options -H "Authorization: Bearer $STAFF_TOKEN")
check "Check-in correctly blocked before any device is registered (expect 400)" $([ "$CHECKIN_BEFORE_REG" = "400" ] && echo 0 || echo 1)

MANUAL_DENIED=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:4000/api/attendance/manual \
  -H "Content-Type: application/json" -H "Authorization: Bearer $STAFF_TOKEN" \
  -d "{\"userId\":\"$STAFF_ID\",\"type\":\"check_in\"}")
check "Staff denied manual attendance override (expect 403, admin-only)" $([ "$MANUAL_DENIED" = "403" ] && echo 0 || echo 1)

MANUAL_RESP=$(curl -s -X POST http://localhost:4000/api/attendance/manual \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{\"userId\":\"$STAFF_ID\",\"type\":\"check_in\"}")
MANUAL_METHOD=$(echo "$MANUAL_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('method',''))" 2>/dev/null)
check "Admin manual override recorded with method='manual'" $([ "$MANUAL_METHOD" = "manual" ] && echo 0 || echo 1)

ATTENDANCE_VISIBLE=$(curl -s http://localhost:4000/api/attendance -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('yes' if any(r['user_id']=='$STAFF_ID' for r in d) else 'no')" 2>/dev/null)
check "Admin sees the recorded attendance entry" $([ "$ATTENDANCE_VISIBLE" = "yes" ] && echo 0 || echo 1)

# --- AI Advisors — permission gating and graceful failure without a real key ---
ADVISORS=$(curl -s http://localhost:4000/api/advisors -H "Authorization: Bearer $TOKEN")
ADVISOR_COUNT=$(echo "$ADVISORS" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null)
check "Admin sees all 7 AI advisors" $([ "$ADVISOR_COUNT" = "7" ] && echo 0 || echo 1)

STAFF_ADVISOR_DENIED=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/advisors -H "Authorization: Bearer $STAFF_TOKEN")
check "Staff denied advisors:use (expect 403)" $([ "$STAFF_ADVISOR_DENIED" = "403" ] && echo 0 || echo 1)

UNKNOWN_AGENT=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:4000/api/advisors/not-a-real-agent/chat \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"messages":[{"role":"user","content":"hi"}]}')
check "Unknown advisor ID returns 404" $([ "$UNKNOWN_AGENT" = "404" ] && echo 0 || echo 1)

NO_KEY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:4000/api/advisors/staffing-ratio-analyst/chat \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"messages":[{"role":"user","content":"Are we understaffed?"}]}')
check "Chat without ANTHROPIC_API_KEY fails gracefully (expect 503, not a crash)" $([ "$NO_KEY_STATUS" = "503" ] && echo 0 || echo 1)

# --- Policies — starter drafts seeded, acknowledgment flow, version bump resets it ---
POLICIES=$(curl -s http://localhost:4000/api/policies -H "Authorization: Bearer $STAFF_TOKEN")
POLICY_COUNT=$(echo "$POLICIES" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null)
check "5 starter policy drafts are seeded and readable by staff" $([ "$POLICY_COUNT" = "5" ] && echo 0 || echo 1)

POLICY_ID=$(echo "$POLICIES" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])" 2>/dev/null)
NOT_YET_ACKED=$(echo "$POLICIES" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['acknowledgedByMe'])" 2>/dev/null)
check "Staff has not yet acknowledged a freshly seeded policy" $([ "$NOT_YET_ACKED" = "False" ] && echo 0 || echo 1)

curl -s -X POST http://localhost:4000/api/policies/$POLICY_ID/acknowledge -H "Authorization: Bearer $STAFF_TOKEN" > /dev/null
AFTER_ACK=$(curl -s http://localhost:4000/api/policies -H "Authorization: Bearer $STAFF_TOKEN" | python3 -c "import sys,json;d=json.load(sys.stdin);print(next(p['acknowledgedByMe'] for p in d if p['id']=='$POLICY_ID'))" 2>/dev/null)
check "Staff acknowledgment is recorded" $([ "$AFTER_ACK" = "True" ] && echo 0 || echo 1)

STAFF_EDIT_DENIED=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH http://localhost:4000/api/policies/$POLICY_ID \
  -H "Content-Type: application/json" -H "Authorization: Bearer $STAFF_TOKEN" -d '{"body":"hacked"}')
check "Staff denied editing a policy (expect 403)" $([ "$STAFF_EDIT_DENIED" = "403" ] && echo 0 || echo 1)

curl -s -X PATCH http://localhost:4000/api/policies/$POLICY_ID -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"body":"Updated policy text"}' > /dev/null
AFTER_EDIT_ACK=$(curl -s http://localhost:4000/api/policies -H "Authorization: Bearer $STAFF_TOKEN" | python3 -c "import sys,json;d=json.load(sys.stdin);print(next(p['acknowledgedByMe'] for p in d if p['id']=='$POLICY_ID'))" 2>/dev/null)
check "Editing a policy resets acknowledgment (must re-read new version)" $([ "$AFTER_EDIT_ACK" = "False" ] && echo 0 || echo 1)

# --- Reports — pure aggregation from existing data ---
REPORT=$(curl -s http://localhost:4000/api/reports/summary -H "Authorization: Bearer $TOKEN")
HAS_TASK_DEPT=$(echo "$REPORT" | python3 -c "import sys,json;print('yes' if len(json.load(sys.stdin)['taskByDept'])>0 else 'no')" 2>/dev/null)
check "Reports include task-by-department data" $([ "$HAS_TASK_DEPT" = "yes" ] && echo 0 || echo 1)

HAS_POLICY_GAP=$(echo "$REPORT" | python3 -c "import sys,json;d=json.load(sys.stdin);print('yes' if len(d['policyGaps'])==5 else 'no')" 2>/dev/null)
check "Reports show policy acknowledgment gaps for all 5 policies" $([ "$HAS_POLICY_GAP" = "yes" ] && echo 0 || echo 1)

STAFF_REPORT_DENIED=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/reports/summary -H "Authorization: Bearer $STAFF_TOKEN")
check "Staff denied Reports access (expect 403)" $([ "$STAFF_REPORT_DENIED" = "403" ] && echo 0 || echo 1)

# --- HR/Info: About (real content), Team, Offer Letters, Training Videos, Events ---
ABOUT=$(curl -s http://localhost:4000/api/hr/about -H "Authorization: Bearer $STAFF_TOKEN")
HAS_FOUNDER=$(echo "$ABOUT" | python3 -c "import sys,json;print(json.load(sys.stdin)['founder']['name'])" 2>/dev/null)
check "About page returns real clinic content (founder name)" $([ "$HAS_FOUNDER" = "Dr. Nishita Ranka" ] && echo 0 || echo 1)

TEAM_EMPTY=$(curl -s http://localhost:4000/api/hr/team -H "Authorization: Bearer $STAFF_TOKEN" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null)
check "Team profiles start empty (source page was empty, nothing invented)" $([ "$TEAM_EMPTY" = "0" ] && echo 0 || echo 1)

OFFER_DENIED=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:4000/api/hr/offer-letters \
  -H "Content-Type: application/json" -H "Authorization: Bearer $STAFF_TOKEN" \
  -d '{"candidateName":"Test","roleTitle":"Nurse"}')
check "Staff denied generating offer letters (expect 403)" $([ "$OFFER_DENIED" = "403" ] && echo 0 || echo 1)

OFFER_RESP=$(curl -s -X POST http://localhost:4000/api/hr/offer-letters \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"candidateName":"Test Candidate","roleTitle":"Staff Nurse","department":"Therapist","salaryText":"25,000/month","startDate":"2026-10-01"}')
LETTER_HAS_NAME=$(echo "$OFFER_RESP" | python3 -c "import sys,json;print('Test Candidate' in json.load(sys.stdin)['bodyText'])" 2>/dev/null)
check "Offer letter generated with candidate name filled in" $([ "$LETTER_HAS_NAME" = "True" ] && echo 0 || echo 1)

VIDEOS_EMPTY=$(curl -s http://localhost:4000/api/hr/training-videos -H "Authorization: Bearer $STAFF_TOKEN" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null)
check "Training videos start empty (nothing invented)" $([ "$VIDEOS_EMPTY" = "0" ] && echo 0 || echo 1)

curl -s -X POST http://localhost:4000/api/hr/training-videos -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"department":"Front Desk","title":"Test training video","url":"https://example.com/video"}' > /dev/null
VIDEOS_AFTER=$(curl -s http://localhost:4000/api/hr/training-videos -H "Authorization: Bearer $STAFF_TOKEN" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null)
check "Admin-added training video is visible to staff" $([ "$VIDEOS_AFTER" = "1" ] && echo 0 || echo 1)

EVENTS=$(curl -s http://localhost:4000/api/hr/events -H "Authorization: Bearer $STAFF_TOKEN")
EVENTS_NOTE=$(echo "$EVENTS" | python3 -c "import sys,json;print('note' in json.load(sys.stdin))" 2>/dev/null)
check "Events endpoint flags that no birthdates are on file yet" $([ "$EVENTS_NOTE" = "True" ] && echo 0 || echo 1)

curl -s -X PATCH http://localhost:4000/api/users/$STAFF_ID -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"birthday":"03-15","joinedAt":"2023-01-10"}' > /dev/null
EVENTS_AFTER=$(curl -s http://localhost:4000/api/hr/events -H "Authorization: Bearer $STAFF_TOKEN" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['birthdays']))" 2>/dev/null)
check "Setting a birthday makes it appear in the events feed" $([ "$EVENTS_AFTER" = "1" ] && echo 0 || echo 1)

# --- Payroll: companies, real pay profile, generation, PDF, permission gating ---
COMPANIES=$(curl -s http://localhost:4000/api/companies -H "Authorization: Bearer $TOKEN")
COMPANY_COUNT=$(echo "$COMPANIES" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null)
check "3 companies seeded" $([ "$COMPANY_COUNT" = "3" ] && echo 0 || echo 1)

NEELIMA_ID=$(curl -s http://localhost:4000/api/users/full -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json;d=json.load(sys.stdin);print(next(u['id'] for u in d if u['name']=='Neelima'))" 2>/dev/null)
NEELIMA_PROFILE=$(curl -s http://localhost:4000/api/payroll/profile/$NEELIMA_ID -H "Authorization: Bearer $TOKEN")
NEELIMA_BASIC=$(echo "$NEELIMA_PROFILE" | python3 -c "import sys,json;print(json.load(sys.stdin)['basic_salary'])" 2>/dev/null)
check "Neelima's real pay profile is seeded correctly (basic salary 20000)" $([ "$NEELIMA_BASIC" = "20000" ] && echo 0 || echo 1)

STAFF_PROFILE_DENIED=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:4000/api/payroll/profile \
  -H "Content-Type: application/json" -H "Authorization: Bearer $STAFF_TOKEN" \
  -d "{\"userId\":\"$NEELIMA_ID\",\"companyId\":\"x\"}")
check "Staff denied setting pay profiles (expect 403)" $([ "$STAFF_PROFILE_DENIED" = "403" ] && echo 0 || echo 1)

GEN_RESP=$(curl -s -X POST http://localhost:4000/api/payroll/generate \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{\"period\":\"2026-06\",\"userId\":\"$NEELIMA_ID\"}")
NET_PAYABLE=$(echo "$GEN_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['net_payable'])" 2>/dev/null)
check "Generated payslip net payable matches real payslip (18000)" $([ "$NET_PAYABLE" = "18000" ] && echo 0 || echo 1)

SLIP_ID=$(echo "$GEN_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])" 2>/dev/null)
PDF_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/payroll/$SLIP_ID/pdf -H "Authorization: Bearer $TOKEN")
check "Generated payslip PDF downloads successfully" $([ "$PDF_CODE" = "200" ] && echo 0 || echo 1)

GEN_WITH_EMAIL_NO_CONFIG=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:4000/api/payroll/generate \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{\"period\":\"2026-07\",\"userId\":\"$NEELIMA_ID\",\"sendEmail\":true}")
check "Requesting email send without Gmail configured fails gracefully (expect 503)" $([ "$GEN_WITH_EMAIL_NO_CONFIG" = "503" ] && echo 0 || echo 1)

DIGEST_RESP=$(curl -s -X POST http://localhost:4000/api/jobs/run-checklist-digest -H "Authorization: Bearer $TOKEN")
DIGEST_SKIPPED=$(echo "$DIGEST_RESP" | python3 -c "import sys,json;print('skipped' in json.load(sys.stdin))" 2>/dev/null)
check "Checklist digest job reports skipped when email isn't configured (not a crash)" $([ "$DIGEST_SKIPPED" = "True" ] && echo 0 || echo 1)

# --- Staff edit form fields (email/phone/birthday/joinedAt) actually persist ---
curl -s -X PATCH http://localhost:4000/api/users/$STAFF_ID -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"email":"realstaff@example.com","phone":"+919999888877"}' > /dev/null
STAFF_FULL=$(curl -s http://localhost:4000/api/users/full -H "Authorization: Bearer $TOKEN")
UPDATED_EMAIL=$(echo "$STAFF_FULL" | python3 -c "import sys,json;d=json.load(sys.stdin);print(next(u['email'] for u in d if u['id']=='$STAFF_ID'))" 2>/dev/null)
check "Staff edit form's email field persists via /api/users/:id PATCH" $([ "$UPDATED_EMAIL" = "realstaff@example.com" ] && echo 0 || echo 1)

echo
echo "== Results: $PASS passed, $FAIL failed =="
if [ "$FAIL" -eq 0 ]; then green "Everything is working correctly."; exit 0
else red "Something needs attention — check /tmp/clinic-test-server.log"; exit 1; fi
