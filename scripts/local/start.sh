#!/usr/bin/env bash
# Run the app locally against a Docker Postgres (data persists in the
# laborers-pg-data volume). Usage: npm run dev:local   then open http://localhost:5050
# Stop with Ctrl+C; `docker stop laborers-pg` stops the database. Ports and
# names differ from the ACL app's (acl-pg, 5433, 5000) so both can run at once.
set -euo pipefail
cd "$(dirname "$0")/../.."

export PG_PORT="${PG_PORT:-5434}" WS_PROXY_PORT="${WS_PROXY_PORT:-5489}" PORT="${PORT:-5050}"
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:${PG_PORT}/laborers"
export SESSION_SECRET="${SESSION_SECRET:-local-dev-session-secret}"
export CRYPTO_SECRET="${CRYPTO_SECRET:-local-dev-crypto-secret}"
export NODE_ENV=development

if ! docker ps --format '{{.Names}}' | grep -qx laborers-pg; then
  docker run -d --rm --name laborers-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=laborers \
    -p "127.0.0.1:${PG_PORT}:5432" -v laborers-pg-data:/var/lib/postgresql/data \
    postgres:17-alpine >/dev/null
fi
until docker exec laborers-pg pg_isready -U postgres -d laborers >/dev/null 2>&1; do sleep 0.5; done

npx drizzle-kit push --force >/dev/null

node scripts/local/wsproxy.mjs &
PROXY_PID=$!
trap 'kill $PROXY_PID 2>/dev/null' EXIT

npx tsx scripts/local/boot.ts
