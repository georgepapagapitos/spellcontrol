// Accuracy of the info-strip picker on groups of REAL same-art printings.
//
//   node --import ./scripts/register-ts-resolve.mjs scripts/info-strip-eval.mjs \
//        --images <dir of <scryfall id>.jpg (normal size)> --groups <groups.json> [--json out.json]
//
// groups.json: [{ name, ill, cards: [{ id, set, cn, ... }] }], each group the
// printings of one card that share an illustration. Every printing in turn is
// the card on the table (rendered at each degradation level in
// info-strip-lib.mjs) and the picker chooses among the group's clean reference
// images. Reports, per level:
//   before  expected accuracy of the current behaviour (the matcher keeps one
//           arbitrary printing of the group: 1/size per scan)
//   right   picker chose the printing on the table
//   wrong   picker chose another printing (the number that must stay near 0)
//   abstain picker returned null, so the caller keeps the current choice
//   after   expected accuracy of picker + fallback (abstains score 1/size)
import fs from 'node:fs';
import path from 'node:path';
import { pickByInfoStrip } from '../src/lib/scanner/info-strip.ts';
import { renderWarp, LEVELS } from './info-strip-lib.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, [])
);
const groups = JSON.parse(fs.readFileSync(args.groups, 'utf8')).filter(
  (_, i) => i % Number(args.stride ?? 1) === 0
);
const bufOf = (id) => fs.readFileSync(path.join(args.images, `${id}.jpg`));

const refs = new Map();
for (const g of groups) {
  for (const c of g.cards) if (!refs.has(c.id)) refs.set(c.id, await renderWarp(bufOf(c.id)));
}

const report = {};
for (const [level, opts] of Object.entries(LEVELS)) {
  const t = { scans: 0, before: 0, right: 0, wrong: 0, abstain: 0, after: 0 };
  for (const g of groups) {
    const cands = g.cards.map((c) => refs.get(c.id));
    for (let i = 0; i < g.cards.length; i++) {
      const scan = await renderWarp(bufOf(g.cards[i].id), { ...opts, seed: 7 + i });
      const pick = pickByInfoStrip(scan, cands);
      t.scans++;
      t.before += 1 / g.cards.length;
      if (pick === null) {
        t.abstain++;
        t.after += 1 / g.cards.length;
      } else if (pick === i) {
        t.right++;
        t.after += 1;
      } else t.wrong++;
    }
  }
  const pct = (x) => Math.round((x / t.scans) * 1000) / 10;
  report[level] = {
    scans: t.scans,
    'before %': pct(t.before),
    'right %': pct(t.right),
    'wrong %': pct(t.wrong),
    'abstain %': pct(t.abstain),
    'after %': pct(t.after),
  };
}
console.table(report);
if (args.json) fs.writeFileSync(args.json, JSON.stringify(report, null, 2));
