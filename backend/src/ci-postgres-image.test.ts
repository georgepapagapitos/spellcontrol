import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// CI's Postgres service pulls from Amazon's public mirror of the official
// image, not Docker Hub. On 2026-10-09 every Backend job failed before a test
// ran: `docker pull postgres:16-alpine` hit Docker Hub's unauthenticated pull
// rate limit, which GitHub's shared runner IPs share with everyone else.
// public.ecr.aws/docker/library/* is the same image without that limit.
//
// The local testcontainer (vitest.global-setup.ts) keeps the Docker Hub name,
// since one machine doesn't hit the limit, but must stay on the same tag.
//
// Fix for a failure here: point the workflow's `image:` at
// public.ecr.aws/docker/library/postgres:<tag>, with the tag CONTAINER_IMAGE uses.
const repoRoot = join(__dirname, '..', '..');
const workflowsDir = join(repoRoot, '.github', 'workflows');
const MIRROR = 'public.ecr.aws/docker/library/';

const localImage = /const CONTAINER_IMAGE = '([^']+)'/.exec(
  readFileSync(join(repoRoot, 'backend', 'vitest.global-setup.ts'), 'utf8')
)?.[1];

const postgresImages = readdirSync(workflowsDir)
  .filter((f) => /\.ya?ml$/.test(f))
  .flatMap((f) =>
    [...readFileSync(join(workflowsDir, f), 'utf8').matchAll(/image:\s*(\S*postgres\S*)/g)].map(
      (m) => [f, m[1]] as const
    )
  );

describe('CI Postgres image', () => {
  it('finds the local pin and at least one workflow service', () => {
    expect(localImage).toMatch(/^postgres:/);
    expect(postgresImages.length).toBeGreaterThan(0);
  });

  it.each(postgresImages)('%s pulls %s from the mirror, on the local tag', (_file, image) => {
    expect(image).toBe(MIRROR + localImage);
  });
});
