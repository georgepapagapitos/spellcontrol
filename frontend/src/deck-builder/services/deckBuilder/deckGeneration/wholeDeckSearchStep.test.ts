// @vitest-environment node
// E513 round 2: the budget note counts the substitutions still standing.
import { describe, expect, it } from 'vitest';
import type { GenerationState } from './state';
import {
  SEARCH_PROGRESS_MESSAGE,
  SEARCH_PROGRESS_PERCENT,
  SEARCH_PROGRESS_SPAN,
} from './searchProgress';
import type { ScryfallCard } from '@/deck-builder/types';
import { reportFields, searchEnabled, stampProvenance, standing } from './wholeDeckSearchStep';

const repair = (cut: string, added: string) => ({ cut, added, reason: '' });
const stateWith = (swaps: Array<{ cut: string; added: string }>) =>
  ({
    wholeDeckSearch: { swaps: swaps.map((s) => ({ ...s, reason: '' })), note: '' },
  }) as GenerationState;

describe('standing budget substitutions', () => {
  const repairs = [
    repair('Skrelv, Defector Mite', 'Tainted Observer'),
    repair('Insight Engine', 'Plague Myr'),
    repair('Sensei Golden-Tail', 'Hapatra, the Desert Frost'),
  ];

  it('is the count the note was given when the search changed nothing', () => {
    expect(standing({} as GenerationState, repairs, 8)).toBe(8);
  });

  it('drops a substitution whose card came back and one whose add went', () => {
    const state = stateWith([
      { cut: 'Viridian Corrupter', added: 'Skrelv, Defector Mite' },
      { cut: 'Hapatra, the Desert Frost', added: 'Reject Imperfection' },
    ]);
    expect(standing(state, repairs, 8)).toBe(6);
  });
});

describe('the search is on unless a build says false', () => {
  it('runs for an unset flag and a true one, and skips an explicit false', () => {
    expect(searchEnabled({})).toBe(true);
    expect(searchEnabled({ wholeDeckSearch: true })).toBe(true);
    expect(searchEnabled({ wholeDeckSearch: false })).toBe(false);
  });

  it('has a progress step the takeover lists, and the bar can move on past it', () => {
    expect(SEARCH_PROGRESS_MESSAGE).toBe('Fine-tuning the list…');
    expect(SEARCH_PROGRESS_PERCENT).toBeGreaterThan(92);
    expect(SEARCH_PROGRESS_PERCENT + SEARCH_PROGRESS_SPAN).toBeLessThan(97);
  });
});

describe('discovery picks are labelled with the link that earned them (E515)', () => {
  const state = {
    wholeDeckSearch: {
      swaps: [
        { cut: 'Bloom Tender', added: 'Hardened Scales', reason: 'r' },
        {
          cut: 'Fathom Mage',
          added: 'Cordial Vampire',
          reason: 'r',
          discovery: 'pays off the creature deaths that Viscera Seer makes',
        },
      ],
      note: '',
    },
  } as GenerationState;
  const cards = ['Hardened Scales', 'Cordial Vampire'].map((name) => ({ name }) as ScryfallCard);

  it('stamps the link on the card, and the search swap as before', () => {
    const provenance: Record<string, string> = {};
    stampProvenance(state, cards, provenance);
    expect(provenance['Cordial Vampire']).toBe(
      'Discovery pick: pays off the creature deaths that Viscera Seer makes (swapped in for Fathom Mage)'
    );
    expect(provenance['Hardened Scales']).toBe(
      'Swapped in for Bloom Tender after checking the whole deck'
    );
  });

  it('carries the link into the report swaps', () => {
    expect(reportFields(state).wholeDeckSearchSwaps?.[1].discovery).toMatch(/Viscera Seer/);
  });
});
