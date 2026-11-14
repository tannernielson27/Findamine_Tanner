#!/usr/bin/env bash
# Load 6 St. George area hunts (seed stgeorge_v1) into PRODUCTION Supabase
# (findamine-tanner, nrqaggncrqsrebllsrkm) in ONE transaction: if any statement fails, nothing changes.
#   bash deploy-st-george-hunts.sh          -> dry run (runs everything, shows the result, then ROLLBACK)
#   bash deploy-st-george-hunts.sh apply    -> runs everything and COMMITs
# Runs once: if the hunts are already loaded it stops without changing anything.
set -uo pipefail
APP="$HOME/Desktop/Findamine/findamineapp"
SEED="$APP/supabase/seed/st_george_hunts.sql"
export PGPASSWORD="$(grep '^SUPABASE_DB_PASSWORD=' "$APP/.env.findamine-tanner.local" | cut -d= -f2- | tr -d '\r"')"
export PGCONNECT_TIMEOUT=15
DB="host=aws-0-us-west-1.pooler.supabase.com port=5432 user=postgres.nrqaggncrqsrebllsrkm dbname=postgres sslmode=require"

if [ "${1:-}" = "apply" ]; then END="commit"; echo "== APPLYING to production"; else END="rollback"; echo "== DRY RUN (will roll back)"; fi

ok=$(psql "$DB" -Atc "select 1" </dev/null)
if [ "$ok" != "1" ]; then echo "Could not connect to the production database; stopping."; exit 1; fi

{
  echo "begin;"
  cat "$SEED"; echo
  echo "\\echo -- hunts:"
  cat <<'SQL'
select h.metadata->>'region' as region, h.title, h.play_mode, h.status, h.review_status, h.is_public, count(f.id) as stops,
       'https://findamine-tanner.vercel.app/browse/' || h.id as link
  from public.hunts h
  left join public.finds f on f.hunt_id = h.id and f.deleted_at is null
 where h.metadata->>'seed' = 'stgeorge_v1'
 group by h.id order by region, h.title;
SQL
  echo "$END;"
} | psql "$DB" -v ON_ERROR_STOP=1 -q -f - 2>&1 | { grep -v "^NOTICE" || true; }

if [ "${PIPESTATUS[1]}" != "0" ]; then echo "== FAILED: nothing was changed"; exit 1; fi
echo "== finished: $END"
