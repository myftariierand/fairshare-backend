#!/usr/bin/env bash
# Runs every end-to-end suite against a throwaway Postgres in Docker. The suites wipe tables, and each
# one refuses to run unless DATABASE_URL points at this container, so a real database can't be touched.
# Pass suite names to run only those: npm run test:e2e -- m9 h11
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# The container name and port are fixed, so runs from different checkouts have to take turns
if command -v flock >/dev/null; then
  exec 9>/tmp/fairshare-e2e.lock
  flock 9
fi
CONTAINER=fairshare-audit-pg

export DATABASE_URL=postgresql://audit:audit@127.0.0.1:55432/audit
export CLIENT_ORIGIN=https://web.test CLOUDINARY_CLOUD_NAME=x CLOUDINARY_API_KEY=x CLOUDINARY_API_SECRET=x
export GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=x GOOGLE_CALLBACK_URL=https://api.test/auth/google/callback
export RESEND_API_KEY=x ACCESS_TOKEN_SECRET=audit-access-secret-for-tests-only-0123456789
export RESET_PASSWORD_SECRET=audit-reset-secret-for-tests-only-0123456789
export TS_NODE_PROJECT="$ROOT/tsconfig.json" TS_NODE_TRANSPILE_ONLY=1

start_db() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1
  docker run -d --rm --name "$CONTAINER" -e POSTGRES_USER=audit -e POSTGRES_PASSWORD=audit -e POSTGRES_DB=audit \
    -p 127.0.0.1:55432:5432 --tmpfs /var/lib/postgresql postgres:18 >/dev/null || exit 1
  until docker exec "$CONTAINER" pg_isready -U audit -d audit -q; do sleep 1; done
  sleep 2
  (cd "$ROOT" && npx prisma migrate deploy >/dev/null) || exit 1
}
trap 'docker rm -f "$CONTAINER" >/dev/null 2>&1' EXIT

# m11 runs the built app and stops the database, so it goes last
if [ "$#" -gt 0 ]; then suites=("$@"); else
  suites=(low emails devices m10 m9 m8 m7 m6 m5 m4 c3 c4 c5 c6 h1 h3 h4 h5 h7 h8 h9 h10 h11 h12 h13 m11)
fi

case " ${suites[*]} " in *" m11 "*) (cd "$ROOT" && npx nest build) || exit 1 ;; esac

start_db
# Run from here so the project's real .env isn't picked up
cd "$ROOT/test/e2e" || exit 1
output="$(mktemp)"
total=0
failed=0
for suite in "${suites[@]}"; do
  docker exec "$CONTAINER" psql -q -U audit -d audit -c 'TRUNCATE "User","BugReport" CASCADE' >/dev/null 2>&1
  timeout 150 node -r ts-node/register -r tsconfig-paths/register "$suite.ts" >"$output" 2>&1
  code=$?
  passed=$(grep -c '^PASS' "$output")
  total=$((total + passed))
  echo "$suite: $passed passed, $(grep -c '^FAIL' "$output") failed, exit $code"
  if [ "$code" -ne 0 ]; then
    failed=$((failed + 1))
    grep -E '^FAIL' "$output"
    # A suite can crash without any failed check, so always show how it ended
    tail -n 15 "$output"
  fi
done
rm -f "$output"

echo "$total checks passed, $failed of ${#suites[@]} suites failed"
[ "$failed" -eq 0 ]
