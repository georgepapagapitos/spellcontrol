#!/usr/bin/env bash
# Installs the PostgreSQL client tools for one major from the PGDG apt repo and
# puts that major's bin dir on PATH for the rest of the job.
#
# pg_dump refuses a server newer than itself, and pg_restore cannot read a
# dump from a newer major, so the client has to be at least the server's major.
# The runner image ships an older client; PGDG carries the current ones.
#
# Usage: scripts/ci-install-pg-client.sh [major]   (default 17)
set -euo pipefail

major="${1:-17}"

sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt-get install -y --no-install-recommends "postgresql-client-$major"

bin="/usr/lib/postgresql/$major/bin"
"$bin/pg_dump" --version
if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$bin" >> "$GITHUB_PATH"
fi
