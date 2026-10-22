#!/usr/bin/env bash
# Seed demo data into the running local app (npm run dev:local first).
# Creates two techs so the shared signer list is visible from both sides.
# These are local test accounts only.
#   Tech 1: tech@acl.test   / password1
#   Tech 2: crew@acl.test   / password1
#   Demo:   User@email.com  / 123        (regular user for demos)
#   Admin:  seeded by the server at boot (see setupAdmin in server/routes.ts)
set -euo pipefail
BASE="${BASE:-http://localhost:5000}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
post() { curl -sf -b "$TMP/$1" -c "$TMP/$1" -H 'Content-Type: application/json' \
  -H "Origin: $BASE" -X POST "$BASE$2" -d "$3" >/dev/null; }
# Register a user; returns non-zero if the account already exists, so its demo
# data is only seeded once (re-running the script is safe).
newuser() { post "$1" /api/auth/register "$2" || { echo "  $3 already exists — skipping"; return 1; }; }

echo "Seeding $BASE ..."
if newuser a '{"email":"tech@acl.test","password":"password1","name":"Test Tech","employeeNumber":"ACL-42"}' tech@acl.test; then
post a /api/entries '[{"date":"2026-10-14","location":"I-70 Glenwood Canyon","method":"DRILLING","hours":9},{"date":"2026-10-15","location":"I-70 Glenwood Canyon","method":"SHOTCRETE","hours":7.5},{"date":"2026-10-16","location":"US-6 Clear Creek","method":"DRILLING","hours":10}]'
post a /api/rope-hours '{"startDate":"2026-10-10","endDate":"2026-10-12","location":"Glenwood Canyon","skills":"Ascent, Descent, Hauling","hours":28,"employer":"Access Limited","maxHeight":"60m"}'
post a /api/supervisors '{"name":"Dana Foreman","email":"dana.foreman@acl.test","phone":"970-555-0101","company":"Access Limited","spratNumber":"S-1234","qualifications":[{"method":"ROPE_ACCESS","level":"Level III"}]}'
fi

if newuser b '{"email":"crew@acl.test","password":"password1","name":"Crew Member","employeeNumber":"ACL-77"}' crew@acl.test; then
post b /api/supervisors '{"name":"Riley Super","email":"riley.super@acl.test","phone":"970-555-0102","company":"Access Limited","qualifications":[{"method":"DRILLING","level":"Level II"},{"method":"SHOTCRETE","level":"Level II"}]}'
fi
if newuser c '{"email":"User@email.com","password":"123","name":"Demo User","employeeNumber":"ACL-100"}' User@email.com; then
post c /api/entries '[{"date":"2026-10-06","location":"I-70 Glenwood Canyon","method":"DRILLING","hours":10},{"date":"2026-10-07","location":"I-70 Glenwood Canyon","method":"DRILLING","hours":9.5},{"date":"2026-10-08","location":"I-70 Glenwood Canyon","method":"SHOTCRETE","hours":8},{"date":"2026-10-13","location":"US-6 Clear Creek","method":"SHOTCRETE","hours":6.5},{"date":"2026-10-14","location":"US-6 Clear Creek","method":"DRILLING","hours":10}]'
post c /api/rope-hours '{"startDate":"2026-10-01","endDate":"2026-10-03","location":"Glenwood Canyon","skills":"Ascent, Descent, Rope to Rope Transfer, Deviation","hours":30,"employer":"Access Limited","workDetails":"Rock scaling and mesh install","maxHeight":"80m"}'
post c /api/rope-hours '{"startDate":"2026-10-09","endDate":"2026-10-09","location":"US-6 Clear Creek","skills":"Ascent, Descent, Hauling","hours":9,"employer":"Access Limited","workDetails":"Anchor drilling on rope","maxHeight":"40m"}'
fi
echo "Done. Log in at $BASE (accounts listed at the top of scripts/local/seed.sh)."
