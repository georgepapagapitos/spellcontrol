// Guard for E1064: the only copy of the production data was Neon's 24-hour
// point-in-time recovery. .github/workflows/db-backup.yml keeps a nightly
// encrypted pg_dump in R2, alerts when it goes stale, and drills a restore.
//
// If this fails, restore the property it names in the workflow (or in
// scripts/db-restore-drill.sh) rather than loosening the test: each one is the
// difference between a backup and a hope.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const wfPath = resolve(root, '.github/workflows/db-backup.yml');
const drillPath = resolve(root, 'scripts/db-restore-drill.sh');

const yml = existsSync(wfPath) ? readFileSync(wfPath, 'utf8') : '';
const drillScript = existsSync(drillPath) ? readFileSync(drillPath, 'utf8') : '';

/** The text of one top-level job, up to the next job. */
function job(name: string): string {
  const start = yml.indexOf(`\n  ${name}:\n`);
  if (start < 0) return '';
  const rest = yml.slice(start + 1);
  const next = rest.slice(3).search(/\n {2}[a-z][a-z-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 3);
}

/** Non-comment text, so a comment can't satisfy an assertion. */
const code = (s: string) =>
  s
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

const SECRETS = [
  'BACKUP_DATABASE_URL',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_ENDPOINT',
  'R2_BUCKET',
  'BACKUP_PASSPHRASE',
];

describe('db backup workflow', () => {
  it('exists, runs nightly, and can be dispatched by hand', () => {
    expect(yml).not.toBe('');
    expect(yml).toMatch(/schedule:\s*\n\s*- cron: '41 3 \* \* \*'/);
    expect(yml).toContain('workflow_dispatch:');
  });

  it('is inert without its secrets: warns and succeeds', () => {
    const backup = job('backup');
    for (const s of SECRETS) expect(backup).toContain(`secrets.${s}`);
    expect(backup).toContain('::warning::');
    expect(backup).toContain('configured=false');
    // Every real step is gated on the configured flag; none can run unconfigured.
    for (const step of ['Install the PostgreSQL', 'Dump and encrypt', 'Upload to R2']) {
      const at = backup.indexOf(step);
      expect(at).toBeGreaterThan(0);
      expect(backup.slice(at, at + 200)).toContain("steps.cfg.outputs.configured == 'true'");
    }
    expect(code(backup)).not.toMatch(/\bexit 1\b[^\n]*configured/);
  });

  it('masks the secrets and never echoes them', () => {
    const backup = job('backup');
    expect(backup).toContain('::add-mask::');
    for (const s of SECRETS) {
      expect(code(yml)).not.toMatch(new RegExp(`echo[^\\n|>]*\\$\\{?${s}\\b`));
    }
  });

  it('dumps in custom format with a client at least the server major', () => {
    const backup = job('backup');
    expect(backup).toContain('pg_dump --format=custom');
    expect(backup).toMatch(/PG_CLIENT_MAJOR: '17'/);
    expect(backup).toContain('SHOW server_version');
    expect(backup).toContain('raise PG_CLIENT_MAJOR');
  });

  it('encrypts before upload, and the plaintext dump never reaches disk', () => {
    const backup = job('backup');
    const enc = backup.indexOf('--symmetric');
    const up = backup.indexOf('aws s3 cp');
    expect(enc).toBeGreaterThan(0);
    expect(up).toBeGreaterThan(enc);
    expect(backup).toContain('--cipher-algo AES256');
    expect(backup).toContain('--passphrase-fd');
    expect(backup).toMatch(/pg_dump[^\n]*\\\n\s*\| gpg/);
    // The uploaded file is the .gpg one, under the dated pg/ prefix.
    expect(backup).toContain('pg/$(date -u +%Y/%m/%d)/spellcontrol-$now.dump.gpg');
    expect(backup).toContain(
      'aws s3 cp --endpoint-url "$R2_ENDPOINT" --only-show-errors backup.dump.gpg'
    );
    expect(backup).not.toMatch(/s3 cp[^\n]*\.dump["\s]/);
  });

  it('prunes backups past 30 days, after the upload', () => {
    const backup = job('backup');
    expect(backup).toContain("RETENTION_DAYS: '30'");
    expect(backup.indexOf('delete-object')).toBeGreaterThan(backup.indexOf('aws s3 cp'));
  });
});

describe('db backup freshness alert', () => {
  const fresh = job('freshness');

  it('runs on its own daily schedule and fails past 36 hours', () => {
    expect(yml).toContain("cron: '23 15 * * *'");
    expect(fresh).toContain("MAX_AGE_HOURS: '36'");
    expect(fresh).toMatch(/-ge "\$MAX_AGE_HOURS"/);
    expect(fresh).toContain('exit 1');
    expect(fresh).toContain('no backup exists');
  });

  it('is inert without its secrets', () => {
    expect(fresh).toContain('::warning::');
    expect(fresh).toContain("steps.cfg.outputs.configured == 'true'");
  });

  it('opens one labelled issue and closes it on green, with no log text in the body', () => {
    const notify = job('notify');
    expect(notify).toMatch(/issues:\s*write/);
    expect(yml.slice(0, yml.indexOf('\n  notify:'))).not.toMatch(/issues:\s*write/);
    expect(notify).toContain('gh issue create');
    expect(notify).toContain('gh issue comment');
    expect(notify).toContain('gh issue close');
    expect(notify).toMatch(/needs:\s*\[backup, freshness, drill\]/);
    expect(notify).not.toMatch(/--log/);
    expect(notify).not.toMatch(/R2_|BACKUP_PASSPHRASE|BACKUP_DATABASE_URL/);
  });
});

describe('db restore drill', () => {
  const drill = job('drill');

  it('runs weekly and restores through the script', () => {
    expect(yml).toContain("cron: '11 5 * * 0'");
    expect(drill).toContain('scripts/db-restore-drill.sh');
    expect(existsSync(drillPath)).toBe(true);
  });

  it('restores only into a throwaway Postgres started on the runner', () => {
    expect(drill).toContain('uses: ./.github/actions/postgres');
    expect(drill).toMatch(/DRILL_DATABASE_URL: postgres:\/\/[^@\s]+@localhost:5432\//);
    // The production URL is not in the drill job's environment at all.
    expect(drill).not.toContain('BACKUP_DATABASE_URL');
    expect(job('backup')).not.toContain('DRILL_DATABASE_URL');
  });

  it('the script refuses a non-local target and never takes the production URL', () => {
    expect(drillScript).toContain('(localhost|127\\.0\\.0\\.1)');
    expect(drillScript).toMatch(/must point at localhost/);
    expect(drillScript).not.toContain('BACKUP_DATABASE_URL');
    const restores = code(drillScript).match(/^pg_restore[^\n]*/gm) ?? [];
    expect(restores.length).toBeGreaterThan(0);
    for (const r of restores) expect(r).toContain('--dbname "$DRILL_DATABASE_URL"');
  });

  it('decrypts and asserts rows in users and the synced tables', () => {
    expect(drillScript).toContain('--decrypt');
    for (const t of ['users', 'user_cards', 'user_decks', 'user_binders']) {
      expect(drillScript).toContain(t);
    }
    expect(drillScript).toMatch(/-le 0/);
  });

  it('is inert without its secrets', () => {
    expect(drill).toContain('::warning::');
    expect(drill).toContain("steps.cfg.outputs.configured == 'true'");
  });
});
