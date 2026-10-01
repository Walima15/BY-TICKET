#!/usr/bin/env sh
# Apply the Supabase shim + all migrations to a throwaway Postgres, then run the RLS tests.
# Usage (repo root): npm run db:test
set -eu
set -o pipefail

docker-entrypoint.sh postgres >/tmp/postgres.log 2>&1 &
i=0
until pg_isready -h 127.0.0.1 -U postgres -q; do
  i=$((i + 1))
  if [ "$i" -gt 100 ]; then cat /tmp/postgres.log; exit 1; fi
  sleep 0.3
done

PSQL="psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
$PSQL -f /supabase/tests/supabase_shim.sql
for f in /supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  $PSQL -f "$f"
done
if [ "${KEEP_RUNNING:-}" = "1" ]; then
  # Used by `npm run db:types`: keep the migrated database up for type generation.
  echo "database ready"
  wait
fi

# Results arrive as NOTICEs on stderr; query output (stdout) is noise.
$PSQL -f /supabase/tests/rls_test.sql 2>&1 >/dev/null | sed -e 's/^psql:[^ ]* NOTICE:  /  /'
