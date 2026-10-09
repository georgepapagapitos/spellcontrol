#!/usr/bin/env node
// Fails if a workflow job's service or container image would be pulled from
// Docker Hub anonymously. Run by ci.yml's registration job; also runnable
// locally with `node scripts/check-workflow-images.mjs`.
//
// WHY THIS EXISTS
// GitHub-hosted runners pull Docker Hub images without credentials, and Docker
// Hub caps anonymous pulls per IP. The runners share IPs, so the cap is hit by
// other people's jobs. On 2026-10-09 every PR's Backend job failed at
// "Initialize containers" with `toomanyrequests: You have reached your
// unauthenticated pull rate limit` (PRs #2797, #2798; E620), on diffs that
// never touched the backend. Re-running didn't help.
//
// The fix is the same official image from a registry without that cap:
// public.ecr.aws/docker/library/<name> mirrors every Docker Official Image.
// An image name with no registry host (`postgres:16-alpine`) or with
// docker.io / registry-1.docker.io resolves to Docker Hub and fails here.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowDir = resolve(root, '.github/workflows');
const errors = [];

// A name has a registry host only when it has a `/` and its first segment has a
// dot or a port, or is `localhost`. Without a `/` the colon is the tag
// (`postgres:16-alpine`), and the name is a Docker Hub repository.
function pullsFromDockerHub(image) {
  const parts = image.split('/');
  const first = parts[0];
  const hasHost = parts.length > 1 && (/[.:]/.test(first) || first === 'localhost');
  const host = hasHost ? first : 'docker.io';
  return ['docker.io', 'index.docker.io', 'registry-1.docker.io'].includes(host);
}

const imageOf = (spec) => (typeof spec === 'string' ? spec : spec?.image);

for (const file of readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f))) {
  const wf = parseYaml(readFileSync(resolve(workflowDir, file), 'utf8'));
  for (const [jobName, job] of Object.entries(wf?.jobs ?? {})) {
    const images = [
      ['container', imageOf(job?.container)],
      ...Object.entries(job?.services ?? {}).map(([name, svc]) => [
        `services.${name}`,
        imageOf(svc),
      ]),
    ];
    for (const [where, image] of images) {
      if (!image || image.includes('${{')) continue;
      if (pullsFromDockerHub(image)) {
        errors.push(
          `${file} → jobs.${jobName}.${where}: "${image}" is pulled from Docker Hub without credentials, ` +
            `which hits its anonymous rate limit on shared runners. Use the public ECR mirror, ` +
            `e.g. public.ecr.aws/docker/library/${image.replace(/^(docker\.io\/)?(library\/)?/, '')}`
        );
      }
    }
  }
}

if (errors.length) {
  console.error(`✖ ${errors.length} workflow image(s) pulled from Docker Hub:\n`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('✔ No workflow service or container image is pulled from Docker Hub anonymously.');
