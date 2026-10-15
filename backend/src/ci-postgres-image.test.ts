import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// CI's Postgres comes off the runner's disk, not a registry. A `services:`
// image is pulled anonymously, and both public registries cap anonymous pulls
// per shared runner IP: Docker Hub's pull rate limit failed every Backend job
// on 2026-10-09 (#2799 moved to public.ecr.aws), then ECR's "toomanyrequests:
// Data limit exceeded" failed Backend CI on 2026-10-13 and on main on
// 2026-10-15, which skipped that day's Fly deploy, and the nightly journey
// with it. The .github/actions/postgres action starts the runner's own
// PostgreSQL instead.
//
// The local testcontainer (vitest.global-setup.ts) still pulls an image, since
// one machine doesn't hit the limit. CI runs the same major.
//
// Fix for a failure here: drop the workflow's Postgres `services:` entry and
// add `uses: ./.github/actions/postgres` after checkout, with the action's
// default `version` on the major CONTAINER_IMAGE uses.
const repoRoot = join(__dirname, '..', '..');
const workflowsDir = join(repoRoot, '.github', 'workflows');
const ACTION = './.github/actions/postgres';

const localImage = /const CONTAINER_IMAGE = '([^']+)'/.exec(
  readFileSync(join(repoRoot, 'backend', 'vitest.global-setup.ts'), 'utf8')
)?.[1];
const localMajor = /^postgres:(\d+)/.exec(localImage ?? '')?.[1];

const actionDefault = /version:[\s\S]*?default:\s*'(\d+)'/.exec(
  readFileSync(join(repoRoot, '.github', 'actions', 'postgres', 'action.yml'), 'utf8')
)?.[1];

const workflows = readdirSync(workflowsDir)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => [f, readFileSync(join(workflowsDir, f), 'utf8')] as const);

/** Workflows whose jobs talk to a Postgres on the runner's localhost. */
const localPostgres = workflows.filter(([, text]) =>
  /postgres:\/\/[^@\s]+@localhost:5432\//.test(text)
);

describe('CI Postgres', () => {
  it('finds the local pin, the action and at least one workflow that needs it', () => {
    expect(localMajor).toMatch(/^\d+$/);
    expect(actionDefault).toMatch(/^\d+$/);
    expect(localPostgres.length).toBeGreaterThan(0);
  });

  it('the action starts the major the local testcontainer pins', () => {
    expect(actionDefault).toBe(localMajor);
  });

  it.each(workflows)('%s pulls no Postgres image', (_file, text) => {
    expect(text).not.toMatch(/image:\s*\S*postgres/);
  });

  it.each(localPostgres)('%s starts the runner Postgres before using it', (_file, text) => {
    const uses = [...text.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    expect(uses).toContain(ACTION);
  });
});
