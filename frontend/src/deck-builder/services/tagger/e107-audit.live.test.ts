// E107 classifier-audit sweep (skipped unless E107_AUDIT=1) — runs every
// oracle-text classifier (role evidence, standalone flags, 23 synergy axes)
// over a Scryfall corpus and dumps per-card firings + tag-vs-evidence
// disagreements for offline analysis. Intended as the periodic new-set sweep:
// diff the outputs against a prior run (or against tagger tags) after a set
// drops to catch wording the regexes miss.
//
// Corpus: a JSON array of slim cards ({name, oracle_text, type_line, keywords,
// card_faces, released_at, set}), e.g. Scryfall's oracle-cards bulk file
// (https://api.scryfall.com/bulk-data) filtered to commander-legal.
//
//   E107_AUDIT=1 E107_CORPUS=<corpus.json> E107_OUT=<dir> \
//     ./node_modules/.bin/vitest run src/deck-builder/services/tagger/e107-audit.live.test.ts
import { describe, it, vi, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const RUN = !!process.env.E107_AUDIT;
const OUT_DIR = process.env.E107_OUT ?? '.';
const CORPUS = process.env.E107_CORPUS ?? path.join(OUT_DIR, 'corpus-commander.json');

const maybeDescribe = RUN ? describe : describe.skip;

maybeDescribe('E107 classifier audit', () => {
  beforeAll(() => {
    const tagsJson = fs.readFileSync(
      path.join(__dirname, '../../../../public/tagger-tags.json'),
      'utf8'
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(tagsJson, { status: 200 }))
    );
  });

  it('sweeps the corpus', { timeout: 600_000 }, async () => {
    const client = await import('./client');
    const { classifyCard } = await import('../synergy/classify');
    const data = await client.loadTaggerData();
    if (!data) throw new Error('tagger data failed to load');

    interface SlimCard {
      name: string;
      oracle_text?: string | null;
      type_line?: string | null;
      keywords?: string[];
      cmc?: number;
      released_at?: string;
      set?: string;
      card_faces?: Array<{ name?: string; oracle_text?: string; type_line?: string }> | null;
    }
    const corpus: SlimCard[] = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));

    const records: Record<string, unknown>[] = [];
    const counts: Record<string, number> = {};
    const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

    for (const raw of corpus) {
      const card = {
        name: raw.name,
        oracle_text: raw.oracle_text ?? undefined,
        type_line: raw.type_line ?? undefined,
        keywords: raw.keywords ?? [],
        card_faces: raw.card_faces ?? undefined,
      };
      const text = (
        card.oracle_text ??
        card.card_faces?.map((f) => f.oracle_text ?? '').join(' ') ??
        ''
      ).trim();

      const tags = client.getCardTags(card.name);
      const tagRoles = client.getAllCardRoles(card.name);
      const validated = client.validateCardRole(card);
      const flags: string[] = [];
      if (client.isProtectionPiece(card)) flags.push('protection');
      if (client.isFreeInteraction(card)) flags.push('freeInteraction');
      if (client.isUntapProducer(card)) flags.push('untapProducer');
      if (client.isBlinkProducer(card)) flags.push('blinkProducer');
      if (client.isExileProducer(card)) flags.push('exileProducer');
      if (client.isExtraCombatPiece(card)) flags.push('extraCombat');
      if (client.isOneSidedWipe(card)) flags.push('oneSidedWipe');
      const syn = classifyCard(card);

      for (const f of flags) bump(`flag:${f}`);
      for (const p of syn.producers) bump(`prod:${p.axis}`);
      for (const p of syn.payoffs) bump(`pay:${p.axis}`);
      for (const r of tagRoles) bump(`tagRole:${r}`);
      if (validated) bump(`validated:${validated}`);
      // Gate-blind: tagged with a primary role but oracle evidence rejects it
      const primary = client.getCardRole(card.name);
      const gateBlind = !!(primary && text && validated === null);
      if (gateBlind) bump(`gateBlind:${primary}`);

      if (tags.length || flags.length || syn.producers.length || syn.payoffs.length || gateBlind) {
        records.push({
          n: card.name,
          y: raw.released_at,
          s: raw.set,
          tl: card.type_line,
          tags: tags.length ? tags : undefined,
          role: primary ?? undefined,
          val: validated ?? undefined,
          gb: gateBlind || undefined,
          fl: flags.length ? flags : undefined,
          pr: syn.producers.length ? syn.producers.map((p) => p.axis) : undefined,
          pa: syn.payoffs.length ? syn.payoffs.map((p) => p.axis) : undefined,
        });
      }
    }

    fs.writeFileSync(path.join(OUT_DIR, 'audit-results.json'), JSON.stringify(records));
    fs.writeFileSync(
      path.join(OUT_DIR, 'audit-counts.json'),
      JSON.stringify({ corpusSize: corpus.length, matchedCards: records.length, counts }, null, 2)
    );
    console.log(`corpus=${corpus.length} matched=${records.length}`);
  });
});
