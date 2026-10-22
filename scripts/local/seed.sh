#!/usr/bin/env bash
# Seed demo data into the running local app (npm run dev:local first).
# Local test accounts only:
#   Member:     member@laborers.test     / password1  (temp journeyman: covered, on the list, one short month at the fund)
#   Apprentice: apprentice@laborers.test / password1  (period 2 apprentice)
#   Admin:      seeded by the server at boot (see setupAdmin in server/routes.ts)
set -euo pipefail
BASE="${BASE:-http://localhost:5050}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
post() { curl -sf -b "$TMP/$1" -c "$TMP/$1" -H 'Content-Type: application/json' \
  -H "Origin: $BASE" -X "${4:-POST}" "$BASE$2" -d "$3" >/dev/null; }
# Register a user; returns non-zero if the account already exists, so its demo
# data is only seeded once (re-running the script is safe).
newuser() { post "$1" /api/auth/register "$2" || { echo "  $3 already exists, skipping"; return 1; }; }

# N weekdays of on-the-job rows in a month: day1..dayN, 8 hrs each.
days() { # user month count employer union
  local rows="" d
  for d in $(seq 1 "$3"); do
    rows+="{\"date\":\"$2-$(printf %02d $((d + (d-1)/5*2)))\",\"location\":\"Hwy 58 widening\",\"method\":\"ON_THE_JOB\",\"hours\":8,\"details\":{\"employer\":\"$4\",\"union\":\"$5\",\"county\":\"Kern\"}},"
  done
  post "$1" /api/entries "[${rows%,}]"
}

echo "Seeding $BASE ..."
if newuser a '{"email":"member@laborers.test","password":"password1","name":"Sam Laborer"}' member@laborers.test; then
  days a 2026-05 15 "Granite Construction" Union
  days a 2026-06 18 "Granite Construction" Union
  days a 2026-07 16 "Granite Construction" Union
  days a 2026-08 12 "Granite Construction" Union
  days a 2026-09 14 "Access Limited" Union
  days a 2026-10 10 "Access Limited" Union
  post a /api/entries '[{"date":"2026-10-17","location":"LTS Bakersfield","method":"CLASSROOM","hours":8,"details":{"course":"Confined Space","school":"LTS Bakersfield"}}]'
  post a /api/union/profile '{"classification":"TEMP_JOURNEYMAN","localNumber":"220","priorOjtHours":0,"priorRsiHours":0,"startingBank":0,"duesPaidThrough":"2026-09"}' PUT
  post a /api/union/fund-reports '{"month":"2026-07","employer":"Granite Construction","hours":128}'
  post a /api/union/fund-reports '{"month":"2026-08","employer":"Granite Construction","hours":72}'
  post a /api/union/dispatch '{"date":"2026-04-28","kind":"REGISTERED"}'
  post a /api/union/dispatch '{"date":"2026-05-01","kind":"DISPATCHED","employer":"Granite Construction"}'
  post a /api/union/dispatch '{"date":"2026-08-20","kind":"LAID_OFF","employer":"Granite Construction"}'
  post a /api/union/dispatch '{"date":"2026-10-01","kind":"REGISTERED","note":"Signed at the hall"}'
  post a /api/certifications '{"name":"OSHA 10","issuingBody":"OSHA","issueDate":"2025-03-10"}'
  post a /api/certifications '{"name":"First Aid / CPR","issuingBody":"American Red Cross","issueDate":"2024-11-05","expiryDate":"2026-11-05"}'
  post a /api/supervisors '{"name":"Dana Foreman","email":"dana.foreman@laborers.test","phone":"661-555-0101","company":"Granite Construction"}'
fi

if newuser b '{"email":"apprentice@laborers.test","password":"password1","name":"Alex Apprentice"}' apprentice@laborers.test; then
  days b 2026-09 20 "Granite Construction" Union
  post b /api/entries '[{"date":"2026-10-03","location":"LTS Bakersfield","method":"CLASSROOM","hours":8,"details":{"course":"OSHA 30","school":"LTS Bakersfield"}}]'
  post b /api/union/profile '{"classification":"APPRENTICE","localNumber":"220","priorOjtHours":520,"priorRsiHours":44,"startingBank":0,"duesPaidThrough":"2026-10"}' PUT
fi
echo "Done. Log in at $BASE (accounts listed at the top of scripts/local/seed.sh)."
