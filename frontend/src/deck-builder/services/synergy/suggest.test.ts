import { describe, it, expect } from 'vitest';
import { analyzeDeckSynergy } from './deckSynergy';
import { deriveNeeds, suggestOffMeta, type SynergyCandidate } from './suggest';
import { CORPUS, type CorpusCard } from './classify.fixtures';
import { COACH_CARDS } from '../deckBuilder/__fixtures__/coach-cards.fixtures';
import type { CardLike } from './text';

const pick = (...names: string[]): CorpusCard[] =>
  names.map((n) => CORPUS.find((c) => c.name === n)!);
const cand = (name: string, inclusion?: number): SynergyCandidate => ({
  card: CORPUS.find((c) => c.name === name)!,
  inclusion,
});

describe('deriveNeeds', () => {
  it('flags a payoff need for a producer-heavy token engine', () => {
    // 5 token producers, 1 payoff → invested + lopsided toward producers.
    const deck = analyzeDeckSynergy(
      pick(
        'Krenko, Mob Boss',
        'Secure the Wastes',
        'Hornet Queen',
        'Grave Titan',
        'Bitterblossom',
        'Impact Tremors' // the lone payoff
      )
    );
    const needs = deriveNeeds(deck);
    expect(needs).toContainEqual(expect.objectContaining({ axis: 'tokens', side: 'payoff' }));
  });

  it('returns no needs for a balanced engine', () => {
    const deck = analyzeDeckSynergy(
      pick(
        'Krenko, Mob Boss',
        'Secure the Wastes',
        'Hornet Queen',
        'Impact Tremors',
        "Cathars' Crusade",
        'Intangible Virtue'
      )
    );
    expect(deriveNeeds(deck)).toEqual([]);
  });
});

describe('suggestOffMeta', () => {
  const producerHeavyTokens = () =>
    analyzeDeckSynergy(
      pick(
        'Krenko, Mob Boss',
        'Secure the Wastes',
        'Hornet Queen',
        'Grave Titan',
        'Bitterblossom',
        'Impact Tremors'
      )
    );

  it('suggests off-meta payoffs that fill the gap, with a reason', () => {
    const deck = producerHeavyTokens();
    const candidates = [
      cand("Cathars' Crusade", 12),
      cand('Intangible Virtue', 9),
      cand('Mirror Entity', 6),
      cand('Sol Ring', 80), // not a token payoff — must not appear
      cand('Counterspell', 4), // off-meta inclusion but no token payoff
    ];
    const suggestions = suggestOffMeta(deck, candidates);
    const names = suggestions.map((s) => s.cardName);
    expect(names).toContain("Cathars' Crusade");
    expect(names).toContain('Intangible Virtue');
    expect(names).not.toContain('Sol Ring');
    expect(names).not.toContain('Counterspell');
    for (const s of suggestions) {
      expect(s).toMatchObject({ axis: 'tokens', side: 'payoff' });
      expect(s.reason.length).toBeGreaterThan(0);
    }
  });

  it('excludes consensus (too-high inclusion) and pure-jank (too-low) cards', () => {
    const deck = producerHeavyTokens();
    const candidates = [
      cand("Cathars' Crusade", 90), // consensus → excluded
      cand('Intangible Virtue', 0.5), // below the off-meta floor → excluded
      // Champion of Lambholt, not Mirror Entity — E139 stopped crediting Mirror
      // Entity's generic (non-token-scoped) anthem as a tokens payoff.
      cand('Champion of Lambholt', 15), // in the window → kept
    ];
    const names = suggestOffMeta(deck, candidates).map((s) => s.cardName);
    expect(names).toEqual(['Champion of Lambholt']);
  });

  it('reserves quota slots for genuinely off-meta (no-inclusion) fills', () => {
    const deck = producerHeavyTokens();
    // Three validated payoffs would fill the default 4 slots; the no-inclusion
    // card (oracle-sourced) only surfaces because a quota slot is reserved.
    const candidates = [
      cand("Cathars' Crusade", 30),
      cand('Intangible Virtue', 25),
      // Champion of Lambholt, not Mirror Entity — E139 stopped crediting Mirror
      // Entity's generic (non-token-scoped) anthem as a tokens payoff.
      cand('Champion of Lambholt', 20),
      cand('Impact Tremors', 15), // 4th validated — would fill the last slot
      cand('Purphoros, God of the Forge'), // no inclusion → genuinely off-meta
    ];
    const withoutQuota = suggestOffMeta(deck, candidates).map((s) => s.cardName);
    expect(withoutQuota).not.toContain('Purphoros, God of the Forge');

    const withQuota = suggestOffMeta(deck, candidates, { offMetaQuota: 1 }).map((s) => s.cardName);
    expect(withQuota).toContain('Purphoros, God of the Forge');
    // Validated fills still lead the list.
    expect(withQuota[0]).toBe("Cathars' Crusade");
  });

  // T171 lane M: Coach ranks a pick that would start an engine below every
  // on-plan move, so the suggestion says which kind it is.
  it('marks a payoff for a budding engine, and only that', () => {
    const budding = analyzeDeckSynergy(pick('Secure the Wastes', 'Hornet Queen', 'Grave Titan'));
    expect(budding.invested).not.toContain('tokens');
    const fills = suggestOffMeta(budding, [cand("Cathars' Crusade", 12)]);
    expect(fills).toEqual([
      expect.objectContaining({ cardName: "Cathars' Crusade", budding: true }),
    ]);

    const invested = suggestOffMeta(producerHeavyTokens(), [cand("Cathars' Crusade", 12)]);
    expect(invested[0].budding).toBeUndefined();
  });

  it('returns nothing when there are no needs', () => {
    const balanced = analyzeDeckSynergy(
      pick(
        'Krenko, Mob Boss',
        'Secure the Wastes',
        'Hornet Queen',
        'Impact Tremors',
        "Cathars' Crusade",
        'Intangible Virtue'
      )
    );
    expect(suggestOffMeta(balanced, [cand('Mirror Entity', 10)])).toEqual([]);
  });
});

// T171 round 3: the Upgrade lane offered off-plan text matches. Waste Not
// ("punishes opponents discarding") went to five decks whose only discard was
// their own looting, a convoke card to decks with few creatures, and Fable of
// the Mirror-Breaker read as a blink engine because its Saga exiles itself and
// returns transformed. Real cards (Scryfall 2026-09-29).
describe('suggestOffMeta — a payoff needs the deck to enable it', () => {
  const real = (name: string): CardLike => ({ ...COACH_CARDS[name] });
  const offPage = (name: string): SynergyCandidate => ({ card: real(name) });

  it('offers an opponent-discard payoff only to a deck that makes opponents discard', () => {
    const looting = analyzeDeckSynergy(
      ['Faithless Looting', 'Cathartic Reunion', "Tsabo's Decree"].map(real)
    );
    expect(suggestOffMeta(looting, [offPage('Waste Not')])).toEqual([]);
    // Page evidence stands in for the missing enabler.
    expect(
      suggestOffMeta(looting, [{ card: real('Waste Not'), inclusion: 6 }]).map((s) => s.cardName)
    ).toEqual(['Waste Not']);

    const handAttack = analyzeDeckSynergy(
      ['Hymn to Tourach', 'Mind Twist', "Tsabo's Decree"].map(real)
    );
    expect(suggestOffMeta(handAttack, [offPage('Waste Not')]).map((s) => s.cardName)).toEqual([
      'Waste Not',
    ]);
  });

  it('offers a convoke card only to a creature-dense deck', () => {
    const thin = analyzeDeckSynergy(pick('Krenko, Mob Boss', 'Secure the Wastes', 'Bitterblossom'));
    expect(suggestOffMeta(thin, [offPage('Hoarding Broodlord')])).toEqual([]);
    const dense = analyzeDeckSynergy(
      pick('Krenko, Mob Boss', 'Secure the Wastes', 'Hornet Queen', 'Grave Titan')
    );
    expect(suggestOffMeta(dense, [offPage('Hoarding Broodlord')]).map((s) => s.cardName)).toEqual([
      'Hoarding Broodlord',
    ]);
  });

  it('offers a planeswalker payoff only to a deck with planeswalkers to cast', () => {
    // Two walkers and a proliferate card: Interplanar Beacon replaced a Forest.
    const two = analyzeDeckSynergy(
      ["Freyalise, Llanowar's Fury", 'Tyvar Kell', 'Contagion Clasp'].map(real)
    );
    expect(suggestOffMeta(two, [offPage('Interplanar Beacon')])).toEqual([]);
    const three = analyzeDeckSynergy(
      ["Freyalise, Llanowar's Fury", 'Tyvar Kell', 'Karn, the Great Creator'].map(real)
    );
    expect(suggestOffMeta(three, [offPage('Interplanar Beacon')]).map((s) => s.cardName)).toEqual([
      'Interplanar Beacon',
    ]);
  });

  it('never reads a Saga that returns itself transformed as a blink engine', () => {
    const fable = real('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki');
    const deck = analyzeDeckSynergy([fable]);
    expect(deck.axes.find((a) => a.axis === 'blink')).toBeUndefined();
  });
});
