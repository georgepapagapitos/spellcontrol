// Guard (T171 lane M): Coach never offers a premium card as a cut. Before this
// module, protection came only from generation stamps, so on a hand-built or
// imported deck Path to Exile read as "Excess Removal" and Fierce
// Guardianship, The One Ring and Imperial Seal as misfits. Real cards,
// Scryfall's 2026-09-29 bulk.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import type { ScryfallCard } from '@/deck-builder/types';
import { setCardFactsSnapshot } from '@/deck-builder/services/cardFacts';
import { COACH_CARDS, coachCardFactsSnapshot } from './__fixtures__/coach-cards.fixtures';
import { isPremiumCard, premiumNames, premiumReason } from './premiumCards';

const card = (name: string): ScryfallCard => ({ ...COACH_CARDS[name] });

afterEach(() => setCardFactsSnapshot(null));

describe('premiumReason without card facts', () => {
  it('reads a Game Changer by name when the deck carries no stamp (an imported deck)', () => {
    for (const name of ['Fierce Guardianship', 'The One Ring', 'Imperial Seal', 'Rhystic Study']) {
      expect(card(name).isGameChanger).toBeUndefined();
      expect(premiumReason(card(name))).toBe('game-changer');
    }
  });

  it('protects the staple rocks by name', () => {
    expect(premiumReason({ ...card('Sol Ring'), edhrec_rank: undefined })).toBe('staple-rock');
  });

  it('protects a staple of the format by its Commander play rank', () => {
    expect(card('Path to Exile').edhrec_rank).toBeLessThanOrEqual(100);
    expect(premiumReason(card('Path to Exile'))).toBe('format-staple');
    expect(premiumReason(card('Swiftfoot Boots'))).toBe('format-staple');
  });

  it("protects a staple of this commander's page, whatever its global rank", () => {
    expect(premiumReason(card('Aetherjacket'))).toBeNull();
    expect(premiumReason(card('Aetherjacket'), { inclusion: 45 })).toBe('commander-staple');
  });

  it('takes the live Game Changers list on top of the shared one', () => {
    const renamed = { ...card('Aetherjacket'), edhrec_rank: 20000 };
    expect(isPremiumCard(renamed, { gameChangerNames: new Set(['Aetherjacket']) })).toBe(true);
  });
});

describe('premiumReason with card facts', () => {
  it('names efficient protection, answers and tutors the rank misses', () => {
    setCardFactsSnapshot(coachCardFactsSnapshot());
    // Tamiyo's Safekeeping is rank 468: only its facts make it premium.
    expect(card("Tamiyo's Safekeeping").edhrec_rank).toBeGreaterThan(100);
    expect(premiumReason(card("Tamiyo's Safekeeping"))).toBe('protection');
    expect(premiumReason({ ...card('Counterspell'), edhrec_rank: 5000 })).toBe('interaction');
    expect(premiumReason({ ...card('Supreme Verdict'), edhrec_rank: 5000 })).toBe('interaction');
    // A free counterspell at three mana (Deadly Rollick is free removal).
    expect(premiumReason({ ...card('Deadly Rollick'), edhrec_rank: 5000 })).toBe('interaction');
  });

  it('leaves the weak cards reviewers named cuttable', () => {
    setCardFactsSnapshot(coachCardFactsSnapshot());
    for (const name of ['Aetherjacket', 'Basalt Monolith', 'Crib Swap']) {
      expect(premiumReason(card(name)), name).toBeNull();
    }
  });
});

describe('premiumNames', () => {
  it('collects the deck cards that are premium, by name', () => {
    const deck = ['Path to Exile', 'Aetherjacket', 'The One Ring', 'Basalt Monolith'].map(card);
    expect([...premiumNames(deck, () => undefined)].sort()).toEqual([
      'Path to Exile',
      'The One Ring',
    ]);
  });
});

// T171 re-gate: Scheming Symmetry (a tutor, rank 1838, a 1-drop the facts
// parser misread) was cut from a Bracket 4 Yuriko. A tutor the bracket
// estimator counts is premium at any cost; Diabolic Tutor (4 mana, rank 485)
// is premium only through that rule.
describe('premiumReason — tutors (tagger)', () => {
  it('protects a tutor the bracket estimator counts', async () => {
    expect(premiumReason(card('Diabolic Tutor'))).toBeNull();
    const here = dirname(fileURLToPath(import.meta.url));
    const data = JSON.parse(
      readFileSync(resolve(here, '__fixtures__', 'tagger-tags.fixture.json'), 'utf8')
    );
    // The live snapshot (public/tagger-tags.json) tags it; the fixture predates it.
    data.tags.tutor.push('Scheming Symmetry');
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => data }));
    try {
      expect(await loadTaggerData()).toBeTruthy();
      expect(premiumReason(card('Diabolic Tutor'))).toBe('tutor');
      expect(premiumReason(card('Scheming Symmetry'))).toBe('tutor');
      expect(premiumReason(card('Aetherjacket'))).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
