#!/usr/bin/env bash
# Run the app locally against a Docker Postgres (data persists in the
# acl-pg-data volume). Usage: npm run dev:local   then open http://localhost:5000
# Stop with Ctrl+C; `docker stop acl-pg` stops the database.
set -euo pipefail
cd "$(dirname "$0")/../.."

export PG_PORT="${PG_PORT:-5433}" WS_PROXY_PORT="${WS_PROXY_PORT:-5488}"
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:${PG_PORT}/acl"
export SESSION_SECRET="${SESSION_SECRET:-local-dev-session-secret}"
export CRYPTO_SECRET="${CRYPTO_SECRET:-local-dev-crypto-secret}"
export NODE_ENV=development

if ! docker ps --format '{{.Names}}' | grep -qx acl-pg; then
  docker run -d --rm --name acl-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=acl \
    -p "127.0.0.1:${PG_PORT}:5432" -v acl-pg-data:/var/lib/postgresql/data \
    postgres:17-alpine >/dev/null
fi
until docker exec acl-pg pg_isready -U postgres -d acl >/dev/null 2>&1; do sleep 0.5; done

npx drizzle-kit push --force >/dev/null

node scripts/local/wsproxy.mjs &
PROXY_PID=$!
trap 'kill $PROXY_PID 2>/dev/null' EXIT

npx tsx scripts/local/boot.ts
