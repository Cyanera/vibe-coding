#!/usr/bin/env bash
# Builds a throwaway local Postgres DB with the schema + seed and runs workflow.sql.
# Usage: sudo ./supabase/tests/run.sh   (needs a local PostgreSQL server)
set -euo pipefail
D="$(cd "$(dirname "$0")/.." && pwd)"
as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else sh -c "$*"; fi; }
as_pg "dropdb --if-exists vibe_test && createdb vibe_test"
as_pg "psql -q -v ON_ERROR_STOP=1 -d vibe_test -f $D/tests/bootstrap.sql -f $D/schema.sql -f $D/seed.sql" 2>&1 | grep -v NOTICE || true
as_pg "psql -q -t -A -v ON_ERROR_STOP=1 -d vibe_test -f $D/tests/workflow.sql" 2>&1 | sed -e 's/^psql:[^ ]* //' -e 's/^NOTICE:  //'
