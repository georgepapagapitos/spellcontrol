#!/usr/bin/env bash
# Restore drill for the nightly encrypted pg_dump (.github/workflows/db-backup.yml).
#
# A backup nobody has restored is a hope. This downloads the newest dump from
# the R2 bucket, decrypts it, restores it into a THROWAWAY Postgres and asserts
# the tables that matter have rows.
#
# It restores ONLY into DRILL_DATABASE_URL, and refuses anything that is not a
# server on this machine (localhost / 127.0.0.1). The production database is
# never a target and its URL is never given to this script.
#
# Needs on PATH: aws (v2), gpg, psql, pg_restore (client major >= the dump's).
# Env: R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_ENDPOINT R2_BUCKET
#      BACKUP_PASSPHRASE DRILL_DATABASE_URL
set -euo pipefail

for v in R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_ENDPOINT R2_BUCKET BACKUP_PASSPHRASE DRILL_DATABASE_URL; do
  if [ -z "${!v:-}" ]; then
    echo "::error::$v is not set"
    exit 2
  fi
done

if ! printf '%s' "$DRILL_DATABASE_URL" | grep -Eq '^postgres(ql)?://[^@]*@(localhost|127\.0\.0\.1)(:[0-9]+)?/'; then
  echo "::error::DRILL_DATABASE_URL must point at localhost or 127.0.0.1; the drill restores only into a throwaway local server"
  exit 2
fi

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

key="$(aws s3api list-objects-v2 --endpoint-url "$R2_ENDPOINT" --bucket "$R2_BUCKET" --prefix pg/ \
  --query 'sort_by(Contents,&LastModified)[-1].Key' --output text)"
if [ -z "$key" ] || [ "$key" = "None" ]; then
  echo "::error::no backup found under pg/ in the bucket"
  exit 1
fi
echo "Newest backup: $key"

aws s3 cp --endpoint-url "$R2_ENDPOINT" --only-show-errors "s3://$R2_BUCKET/$key" "$work/dump.gpg"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt \
  --output "$work/dump" "$work/dump.gpg" 3<<<"$BACKUP_PASSPHRASE"
rm -f "$work/dump.gpg"

pg_restore --no-owner --no-acl --dbname "$DRILL_DATABASE_URL" "$work/dump"

fail=0
for t in users user_cards user_decks user_binders; do
  n="$(psql "$DRILL_DATABASE_URL" -tAc "SELECT count(*) FROM $t")"
  echo "restored $t: $n rows"
  if [ "${n:-0}" -le 0 ]; then
    echo "::error::table $t restored with no rows"
    fail=1
  fi
done
exit "$fail"
