# Runbook

What to do when production misbehaves. Each section is one incident class with
the same shape: Symptom, Check, Fix, Rollback, and where it applies, Do not.
Commands are meant to be pasted. Where a command needs the Fly CLI, run
`flyctl auth login` first; a stale login prints "your flyctl session has
expired".

The README says what the app does and ARCHITECTURE.md says where the code is.
This file is for the moment something is wrong.

## Facts you need first

- One Fly app serves everything: the API and the built web app. App name
  `spellcontrol-api`, region `ord`, site `https://spellcontrol.com`. A frontend-only
  change is deployed by the same workflow as a backend change.
- It runs on exactly one machine with one volume (`spellcontrol_data`, mounted at
  `/data`). The volume holds the SQLite card cache and the offline bulk files.
  User data is in Postgres (Neon), not on the volume. Do not scale to two
  machines: the online table's realtime state and the card cache are
  per-machine, so a second machine splits them silently (see `fly.toml` and
  `backend/src/fly-topology.ts`, which logs a `[topology]` error if it sees more
  than one).
- Fly's health check is `GET /health` every 30 s with a 15 s timeout. `/health`
  never touches Postgres on purpose. Healthy output:

  ```
  $ curl -s -m 20 -w '\n%{http_code} %{time_total}s\n' https://spellcontrol.com/health
  {"ok":true,"cache":{"total":111904,"fresh":111110}}
  200 0.16s
  ```

  `total` and `fresh` are card-cache row counts, so the numbers drift. `fresh`
  close to `total` is healthy.

- Deploys are chained off CI. A merge to `main` runs CI, and only a green CI run
  fires `.github/workflows/fly-deploy.yml`, which runs
  `flyctl deploy --remote-only`. A red CI run on `main` skips the deploy and
  production keeps serving the previous build.
- Process guards at the top of `backend/src/server.ts` log uncaught exceptions
  and unhandled rejections and stay up. This is deliberate; the reason is under
  "503 or very slow responses".
- Secrets are named here, never valued. Production secrets live in Fly
  (`flyctl secrets list --app spellcontrol-api` does not print values).
  CI secrets live in the repository settings (`gh secret list` prints names
  only).

## First five minutes

Do these in order. Stop at the first one that explains the symptom.

1. Is the site answering, and how fast?

   ```
   curl -s -m 20 -o /dev/null -w '%{http_code} %{time_total}s\n' https://spellcontrol.com/health
   ```

   `200` in well under a second is healthy. `503` from the proxy, a timeout, or
   a 200 that takes more than a few seconds go to "503 or very slow responses".

2. Did a deploy just happen, or fail to happen?

   ```
   gh run list --workflow "Deploy to Fly" --limit 3
   gh run list --workflow CI --branch main --limit 3
   ```

   A failed or skipped deploy, or a deploy that finished minutes before the
   symptom started, go to "Bad release or deploy problems".

3. Is the machine up and the check passing?

   ```
   flyctl status --app spellcontrol-api
   flyctl machine list --app spellcontrol-api
   ```

   Look for one machine in state `started` with its check passing. A machine that
   keeps restarting goes to "Process exits".

4. Read the last logs.

   ```
   flyctl logs --app spellcontrol-api --no-tail
   ```

   Lines worth searching for: `[server] listening`, `[matcher] ready`,
   `UNCAUGHT EXCEPTION`, `UNHANDLED REJECTION`, `[db]`, `[heartbeat]`,
   `[scryfall-bulk]`, `[topology]`, `[boot] starting deferred`.

5. Is the database up? `/health` does not tell you. The uptime heartbeat probes
   it every 5 minutes (a `SELECT 1` with a 5 s ceiling, retried once) and the
   monitor pages when it fails. Logs show `[heartbeat] database probe failed`.
   See "Database unreachable".

Two facts that save time:

- One 200 is not recovery. A crash-looping process answers fine between
  restarts. Sample `/health` several times and look at the machine's last update
  time in `flyctl machine status`; a time that keeps moving means restarts.
- Do not state "deployed" or "not deployed" from memory or from a green PR
  check. Read the workflow run.

## 503 or very slow responses

Symptom: the site returns 503, or `/health` takes many seconds, while the
process is alive. Fly's proxy removes the only instance when its health check
times out, so a busy but healthy process looks like an outage. This happened on
2026-08-17.

Check:

```
curl -s -m 30 -o /dev/null -w '%{http_code} %{time_total}s\n' https://spellcontrol.com/health
flyctl machine list --app spellcontrol-api
flyctl machine status <machine id> --app spellcontrol-api
flyctl logs --app spellcontrol-api --no-tail
```

In `flyctl machine status`, read the event log first. One line separates the
cases: an exit event with `exit_code=1` is a crash, `oom_killed=true` is memory,
`requested_stop=true` is a deliberate stop, and no exit event with a failing
check is eviction by the health check. Then in the logs look for which
background job is running. Jobs start after a boot delay (default 90 s,
`BOOT_DEFER_MS`) plus their own offset; the log line is
`[boot] starting deferred <name>`. Names: combo ingest, aggregates rollup,
precon seed, retention sweep, scryfall bulk ingest, scanner matcher preload,
uptime heartbeat.

Fix:

- If a background job is saturating the process, switch that job off and restart.
  Each has a kill switch read at boot. Setting a secret restarts the machine:

  ```
  flyctl secrets set SCRYFALL_BULK_INGEST_DISABLED=1 --app spellcontrol-api
  ```

  The switches in `backend/src/server.ts` are `SCRYFALL_BULK_INGEST_DISABLED`,
  `SCANNER_PRELOAD_DISABLED`, `COMBOS_INGEST_DISABLED`,
  `AGGREGATES_ROLLUP_DISABLED`, `PRECON_SEED_DISABLED`, `RETENTION_DISABLED` and
  `UPTIME_HEARTBEAT_DISABLED`. The daily oracle bulk refresh has its own,
  `OFFLINE_BULK_DISABLED` (`backend/src/offline/bulk-cache.ts`).

- If nothing identifies a job and the machine is stuck, restart it:

  ```
  flyctl machine restart <machine id> --app spellcontrol-api
  ```

Rollback: remove the switch when the cause is fixed:

```
flyctl secrets unset SCRYFALL_BULK_INGEST_DISABLED --app spellcontrol-api
```

Do not:

- Switch the bulk ingest off and forget it. Card lookups ignore cached rows
  older than 36 hours (`PRICE_MAX_AGE_MS` in `backend/src/routes/card-lookup.ts`),
  so about 36 hours after the last successful ingest by-name lookups start
  missing the cache.
- Add `process.exit()` to the process guards, or "fix" them to exit. Every fault
  on 2026-08-17 was a stray error on a background stream or connection while the
  HTTP server was fine, and with one machine and no sibling, exiting was the
  outage. A process that is truly wedged stops answering `/health` and Fly
  replaces it. The one exception is a failed `listen`, which already exits.
  If an `UNCAUGHT EXCEPTION` line appears in the logs, treat it as a bug report:
  find the emitter and give it an error listener.
- Scale up CPU expecting it to fix event-loop starvation. A second core cannot
  help work that blocks the single event loop that also answers `/health`. The
  Scryfall bulk ingest now runs in a `worker_thread` for this reason.
- Look for a "failure threshold" setting on the health check. `[[http_service.checks]]`
  has no such field (`grace_period`, `interval`, `method`, `timeout`, `path`).
- Run `flyctl scale` by hand without matching `fly.toml`. The next deploy
  restores the values in `fly.toml` (2 shared CPUs, 2048 MB), which is how a
  manual fix silently reverts.

## Process exits (crash or restart loop)

Symptom: `/health` works, then fails, then works; `flyctl machine status` shows
the update time moving or exit events.

Check:

```
flyctl machine status <machine id> --app spellcontrol-api
flyctl logs --app spellcontrol-api --no-tail
```

Read the exit event: `exit_code`, `oom_killed`, `requested_stop`. Then read the
stack in the log before forming a theory; the stack names the library.

- `oom_killed=true`: memory. `fly.toml` sets 2048 MB and Node's old-space cap is
  1536 MB. An earlier 1 GB machine was OOM-killed during the oracle bulk rebuild.
- `exit_code=1` right after boot with `listen failed`: the port is taken or
  invalid. The process exits on purpose so Fly restarts it.
- `exit_code=1` with `bad magic` or a matcher error: see "Scanner matcher fails".
- Anything else: an unhandled `'error'` event is fatal in Node. The known sources
  already have listeners (`backend/src/db/index.ts` attaches both a pool-level and
  a per-client listener, and streams go through `pipeForwardingErrors`). A new
  crash is a new emitter without a listener.

Fix: the code change that gives the emitter an owner. To stop the bleeding,
roll back (below) if a deploy preceded the crashes.

Do not: trust one clean 200 as proof of recovery, and do not call a fix complete
until you have grepped every path that can raise the same event. The pool
listener alone was not enough in 2026-08 because checked-out clients are not
covered by it.

## Bad release or deploy problems

### Merged but not live, or the deploy run is red

Symptom: a change is on `main` and not on the site.

Check:

```
gh run list --workflow "Deploy to Fly" --limit 3
gh run list --workflow CI --branch main --limit 3
flyctl releases --app spellcontrol-api
```

Reading the results:

- Deploy run `completed skipped`, or a run of the `not-deployed` job that failed
  on purpose: main CI was red, so nothing deployed. Read the failing job
  (`gh run view <run id> --log-failed`) before rerunning. A rerun is only right
  for a known flake. When CI is green again the deploy fires by itself.
- Deploy run `cancelled` with no jobs: usually a pending run that a newer queued
  run replaced (seen beside a later success on the same commit). Look at the
  newest run instead. The workflow never cancels a deploy that is in progress.
- Deploy run failed in the `deploy` job: an image build or flyctl problem. Read
  it with `gh run view <run id> --log-failed`. Typical causes are a new
  `packages/*` directory with no stage in `backend/Dockerfile` (the build fails
  only in the image build, not in CI), and the scanner data file arriving as a
  Git LFS pointer (the Dockerfile now fails the build on that).
- Deploy green and the release list shows a new version: the machine restarts
  with the new image. Confirm the boot (below).

Confirm a deploy booted:

```
flyctl logs --app spellcontrol-api --no-tail
```

You want `[server] listening` and `[matcher] ready` with timestamps newer than
the release. For a frontend change, the served entry script name changes when the
bundle does:

```
curl -s https://spellcontrol.com/ | grep -o 'assets/index-[^"]*\.js'
```

A string you added may live in a sibling chunk, not the entry file, so a missing
string in the entry is not proof the deploy failed.

Fix: redeploy the current `main` without a code change (for example after a
rotated secret):

```
gh workflow run "Deploy to Fly"
```

Deploys are for CI to do. A deploy from a laptop does not carry the two
`VITE_GOOGLE_*` build arguments the workflow passes, and the Drive picker would be
missing from that bundle.

### Roll back a bad release

Use this when the new release is broken and a fix will take longer than a
rollback. `fly-deploy.yml` has no rollback job; the rollback is a redeploy of an
earlier image.

1. Find the image of the last good release:

   ```
   flyctl releases --app spellcontrol-api --image
   ```

   Pick the newest release from before the problem started and copy its image
   reference.

2. Stop the pipeline from re-shipping the bad commit. The next green CI run on
   `main` fires the deploy workflow, which would undo your rollback:

   ```
   gh workflow disable "Deploy to Fly"
   ```

3. Deploy that image. Run it from a checkout of `main`, because flyctl reads
   `fly.toml` from the current directory for the VM size and health check:

   ```
   flyctl deploy --app spellcontrol-api --image <image reference>
   ```

   There is no build, so no `--remote-only` or build arguments are needed. The
   machine has one volume, so expect a short gap while it is replaced.

4. Confirm: `flyctl status --app spellcontrol-api`, then the `/health` curl, then
   the boot lines in the logs.
5. Revert the bad commit on `main` through a normal PR (`git revert <sha>`), merge
   it, then turn the pipeline back on and watch the deploy land:

   ```
   gh workflow enable "Deploy to Fly"
   ```

Things that can go wrong:

- The schema moves forward only. `ensureSchema()` in `backend/src/db/index.ts`
  applies additive statements at boot and there is no down step. An older image
  runs against the newer schema. Before rolling back across a release that
  changed `db/index.ts`, read that diff for anything the older code would
  mishandle, such as a new column the old code does not write.
- If flyctl cannot pull the old image, fall back to reverting the commit and
  letting CI deploy it (roughly 10 minutes for CI plus the deploy).
- A rollback does not undo secrets or `fly.toml`. For a config change, redeploy
  with the previous `fly.toml`.

Do not: leave the deploy workflow disabled. Write the re-enable step into the
revert PR so it is not forgotten.

### Scanner matcher fails

Symptom: scans fail or fall back to the weak on-device match; logs show
`bad magic` or `scanner matcher preload failed`. Cause seen once (2026-06): the
deploy checkout lacked Git LFS, so `card-embeddings.bin` shipped as a 133 byte
pointer and CI stayed green because tests never load the real file.

Check: `flyctl logs --app spellcontrol-api --no-tail` for
`scanner matcher preloaded` (healthy, with hash and embedding counts) or the
error. Check the workflow still runs the `lfs-pull` step.

Fix: redeploy from a correct checkout (`gh workflow run "Deploy to Fly"`). The
Dockerfile now fails the image build when the file is under 1 MB, so this should
show up as a red deploy, not a silent stub.

Rollback: the image rollback above.

## Database unreachable

Symptom: the heartbeat monitor pages with "database probe failed", sign-in and
sync fail with 5xx, while `/health` is still 200.

Check:

```
flyctl logs --app spellcontrol-api --no-tail
```

Look for `[db] idle client error` and `[db] client error` (a dropped
connection, logged and recovered; Neon recycles compute and drops connections as
normal behavior) versus repeated query failures. Check the provider's status
page and dashboard for the project.

Fix: single dropped connections need nothing; the pool opens a new one. If the
provider is down, wait. If the pool is exhausted or stuck, restart the machine
(`flyctl machine restart <machine id> --app spellcontrol-api`).

Rollback and recovery: Neon's own point-in-time recovery on the free tier covers
24 hours (stated in `.github/workflows/db-backup.yml`). The repository also has
a nightly encrypted dump workflow, `db-backup.yml`, but it is inert until all six
secrets exist: `BACKUP_DATABASE_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_ENDPOINT`, `R2_BUCKET`, `BACKUP_PASSPHRASE`. Until then every job logs a
warning and exits green, so a green "DB backup" run proves nothing. Check:

```
gh secret list
```

If any of the six names is missing, there are no dumps. When configured, the
workflow keeps dumps for 30 days, alerts through an issue labelled `db-backup` if
the newest is over 36 hours old, and runs a weekly restore drill into a throwaway
Postgres (label `db-restore-drill`). `scripts/db-restore-drill.sh` shows the
restore steps.

Do not:

- Make `/health` query Postgres. A database blip would then fail Fly's check and
  evict the only instance for a problem a restart cannot fix.
- Mutate production rows without first dumping the affected rows to a local file.
  For a repair that must reach clients, set `rev = nextval('user_data_rev_seq')`
  (clients pull rows with a higher rev than their cursor) and remember that
  `updated_at` is in epoch milliseconds.

## Client error burst alert

Symptom: the uptime monitor reports a failure whose body reads
`<n> client errors in the last 15 min (threshold 25)`, while the site answers.
The usual cause is a release whose bundle crashes in browsers.

Check: sign in as an admin and open Admin, then the Analytics tab. It lists
distinct client errors by count, with the message and a frame such as
`<chunk>.js:line:col`, and Core Web Vitals bands per route. Match the chunk and
the time to the latest release.

Details that change how you read it:

- The burst counter is in memory. A restart or deploy empties it, so an alert that
  goes quiet after a deploy is expected.
- Each caller counts at most 9, so at least three distinct callers are needed to
  cross the default threshold of 25. One noisy browser cannot page you.
- `ERROR_BURST_ALERT` sets the threshold, and `0` turns the check off. If you
  change it, retune `ERROR_HITS_PER_IP_CAP` in `backend/src/routes/events.ts`.

Fix: ship the fix, or roll back the release (above) if it is a bad deploy.

Rollback: the image rollback above.

## Firefox "serialized value is too large"

Symptom: on Firefox only, a page that reads a large local store fails with
`The serialized value is too large (size=... max=257949696)`. In 2026-09 both
combo surfaces (the deck editor's Power view and `/collection/combos`) failed for
every Firefox user the day the dataset crossed the limit.

Cause: Firefox caps one IndexedDB response at 246 MiB (256 MiB message limit
minus 10 MiB). A single `getAll()` over a big store fails; Chromium streams the
same call and Safari has a different limit, so it looks like a data bug on one
browser. The combo store grows with each nightly ingest (about 107,000 rows and
163 MB of JSON in 2026-09, and larger once structured-cloned).

Check:

1. Reproduce in Firefox with a signed-out or test profile: open
   `/collection/combos` and look for the alert. The console warning
   `[combos] local matcher failed, falling back to the server` means the guard
   below caught it.
2. Find the read: any `getAll()` with no count or key range over a store that can
   reach tens of megabytes. The combo store is paged by key in
   `frontend/src/lib/offline/db.ts` (`iterateComboPages` reads `READ_BATCH` rows per
   page and asks for the next page with `IDBKeyRange.lowerBound(lastId, true)`).

Fix: page the read by key range or use a cursor, as `iterateComboPages` and
`iterateAllCards` do. Do not read a large store whole.

Rollback: not a server problem, and a server rollback does not help. The combo
matcher already falls back to the server (`/api/combos/match`, capped candidates,
shown as partial results) when the local matcher throws, so a storage failure
degrades the answer instead of showing a raw error. Keep that `try/catch` when
editing `frontend/src/lib/api/combos.ts`.

Do not tell a signed-out user to clear site data. Their collection lives only in
that browser until they sign in.

## Scryfall bulk ingest stale or stuck

Symptom: card lookups and imports go to live Scryfall; `/health` shows `fresh`
far below `total`; logs have no recent `[scryfall-bulk] ingest done`.

How it runs: a worker thread downloads the `default_cards` dump (about 450 MB)
to the volume, then writes about 107,000 rows into the SQLite cache. It starts
about 3.5 minutes after boot (90 s boot delay plus a 120 s offset) and every 24
hours, and skips when the last success is under 20 hours old. The healthy log
line is:

```
[scryfall-bulk] ingest done in <ms>ms, wrote <n> cards, <n> aliases, skipped <n>
```

Check:

```
flyctl logs --app spellcontrol-api --no-tail
```

Look for `[scryfall-bulk]` lines: `downloading`, `reusing already-downloaded dump`
(a resume), `worker exited with code`, `previous ingest still running a full
interval later - terminating it`. Remember a flush of 1,000 cards can take
minutes on the volume, so a short window with no progress is not proof of a hang;
compare across hours.

Fix: a restart re-arms the schedule (subject to the 20 hour recency guard) and an
interrupted download resumes from the partial file. If the job is starving the
site, use the kill switch from "503 or very slow responses". If the volume is
full, see below.

Rollback: not applicable; the cache is rebuilt from Scryfall.

## Storage volume filling up

Symptom: ingest fails or restarts forever, SQLite write errors in the logs, or
`ENOSPC`. The volume starts at 1 GB (`initial_size` in `fly.toml`) and holds the
card cache, the offline bulk files, and the in-flight bulk download
(`scryfall-bulk.partial.jsonl.gz` and its marker, removed after a successful
ingest). A measurement in 2026-08 left 379 MB free beside a 526 MB cache.

Check:

```
flyctl volumes list --app spellcontrol-api
flyctl ssh console --app spellcontrol-api -C "df -h /data"
```

Fix: extend the volume (the size is the target in GB, and most machines do not
need a restart):

```
flyctl volumes extend <volume id> --size <GB> --app spellcontrol-api
```

Rollback: none. There is no shrink command, so extend by a deliberate amount.
Stale partial downloads in `/data` are safe to remove once no ingest is running.

## Nightly journey is red

Symptom: a GitHub issue labelled `nightly-journey` is open. The workflow
(`nightly-journey.yml`, daily at 09:17 UTC) builds the production frontend,
serves it from the backend on a runner, and drives Chrome (phone and desktop) and
Firefox through sign-up, a sample collection, deck creation and every route. It
fails on a console error, uncaught error, horizontal overflow, empty body or
missing title.

Check:

```
gh run list --workflow "Nightly journey" --limit 5
gh run view <run id> --log-failed
gh run download <run id> --name journey-<run id> --dir <scratch dir>
```

The artifact `journey-<run id>` holds screenshots and `backend.log`;
`journey-output-<run id>` holds the text output the issue is built from. Both
are kept 14 days.

Fix: file the defect with the screenshot and fix the code; a fix ships with the
guard that would have caught it. A screen that shows an empty state with zero
console errors points at the bundle first. The workflow greps `frontend/dist`
for the Vite dev-proxy paths `/edhrec-api` and `/scryfall-api`, which appear
when `NODE_ENV=development` leaks into `vite build`.

Rollback: not applicable; the job does not deploy.

Do not rerun on reflex. A rerun that passes buries the failure.

## Scanner data refresh fails its write floor

Symptom: the Scanner Ingest run (1st and 15th of each month, 04:00 UTC) fails
with `refusing to replace ... wrote <n> records, under 90% of <m>`.

Cause: the floor in `backend/src/scanner/ingest-guards.ts` refuses to replace
`card-hashes.bin` or `card-embeddings.bin` with a file holding under 90% of the
previous record count. It exists because the refresh opens an auto-merging PR,
and Scryfall retires the `art_crop` image on 2027-01-01 in favor of `art`; a key
that goes missing makes every card skip and the ingest "succeed" with a near
empty file.

Check: the failed run's log, then `extractArtUrl` in `ingest-guards.ts` against
the current Scryfall bulk shape.

Fix: correct the key lookup and rerun with `gh workflow run "Scanner Ingest"`. The
old files stay in place on a refused run, so scanning keeps working on the last
good data. Raise `BASELINE_RECORD_COUNT` when the corpus grows.

Rollback: none needed; nothing was written.

Do not lower `MIN_RETAINED_RATIO` to get a run through.

## A user reports a change did not save

Symptom: "my edit disappeared" on one device. Before treating it as data loss,
look for the toast. A signed-in client writes straight to the server; a failed
write is not lost, it is handled by type:

- Failed upserts stay on the device and are re-sent on the next start, on
  `online`, on focus, or from the toast's Retry. Toast: "Couldn't save N changes.
  Kept on this device."
- Failed deletes revert to their previous state. Toast: "Couldn't save that
  change. Try again." The row reappearing is the designed behavior, not a lost
  update, so look for this toast before filing data loss.
- Over the per-account storage cap the server answers 413 with its own message and
  the client shows it with no Retry. The cap is `USER_STORAGE_CAP_BYTES` (default
  512 MB) and each row is charged 200 bytes beyond its data, tombstones included.
- The sync endpoint is limited to 600 requests per minute (`syncLimiter` in
  `backend/src/routes/sync.ts`). A 429 there reverts the local edit with the
  same "Couldn't save" toast.

Check: ask for the toast text and whether the user was offline. Check the logs
for 413 and 429 responses on the sync route. Account usage can be measured with
the read-only probe below.

Fix: raise the cap for that account only if the data is legitimate; otherwise
nothing to repair. The conflict model is last write wins per row, so two devices
editing the same row can overwrite each other without any error.

Do not write rows into `user_*` tables by hand without the `rev` rule in
"Database unreachable".

## Read-only production database probe

Use this to answer a question about production data without handling the
connection string. The script runs inside the Fly container, where `DATABASE_URL`
is already in the environment, so the secret never reaches your terminal or your
shell history. `flyctl ssh console` enters production, so run it yourself and keep
the script read-only.

Write the script to a local file, for example `probe.js`:

```js
const { Pool } = require('/app/backend/node_modules/pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const res = await client.query('SELECT count(*)::int AS users FROM users');
    console.log(JSON.stringify(res.rows));
    await client.query('ROLLBACK');
  } finally {
    client.release();
    await pool.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

Run it by feeding the file on standard input:

```
flyctl ssh console --app spellcontrol-api -C node < ./probe.js
```

Details that matter:

- Require `pg` by its absolute path. The image keeps the backend at `/app/backend`,
  the SSH session starts in `/app`, and a bare `require('pg')` fails with
  `MODULE_NOT_FOUND`.
- Use standard input, not `node -e`. SQL string literals inside JS inside
  `sh -c` inside `flyctl -C` cannot be quoted reliably. Prefer bound parameters
  and `jsonb_exists(data->$1, $2)` over the `?` operator to keep quotes out of
  the SQL.
- `BEGIN READ ONLY` makes Postgres reject writes from this session.
- User data is in per-entity tables (`user_decks`, `user_cards`, `user_binders`,
  `user_lists`, `user_games`, `user_imports`) with the columns `user_id`, `id`,
  `data` (jsonb, the whole entity), `rev`, `deleted_at` and `updated_at`. Live
  rows have `deleted_at IS NULL`; tombstones have `data = NULL`.
- Keep the script readable. Do not ship it as an encoded blob that the session
  decodes on the machine.

## When to stop and escalate

- You cannot tell crash from eviction after reading the machine event log: stop
  changing things and capture `flyctl machine status`, the logs, and the release
  list before the next restart, because a restart clears the evidence.
- A fix needs a production data write: dump the affected rows first and write only
  with the account owner's go-ahead.
