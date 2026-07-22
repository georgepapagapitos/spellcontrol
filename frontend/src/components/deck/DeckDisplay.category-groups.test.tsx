// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard, DeckCategory } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard, type DeckDisplayProps } from './DeckDisplay';

// Stub the thumbnail network leaf so nested DeckCardRows don't reach out
// (avoids the post-teardown fetch flake — same stub as the other DeckDisplay
// test suites).
vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

// Controllable tagger-readiness — mirrors both the real hook's contract
// (false until tagger data loads) and the role lookup Sol Ring resolves
// through once "loaded", so the re-bucket-once test can flip a REAL
// classification result, not just a flag with no effect.
let taggerReady = false;
vi.mock('@/lib/use-tagger-ready', () => ({ useTaggerReady: () => taggerReady }));
vi.mock('@/deck-builder/services/tagger/client', () => ({
  validateCardRole: (card: { name: string }) =>
    taggerReady && card.name === 'Sol Ring' ? 'ramp' : null,
  getCardRole: (name: string) => (taggerReady && name === 'Sol Ring' ? 'ramp' : null),
  cardMatchesRole: (name: string, role: string) =>
    taggerReady && name === 'Sol Ring' && role === 'ramp',
  hasMultipleRoles: () => false,
  getRampSubtype: () => null,
  getRemovalSubtype: () => null,
  getBoardwipeSubtype: () => null,
  getCardDrawSubtype: () => null,
}));

function card(
  name: string,
  type_line: string,
  overrides: Partial<ScryfallCard> = {}
): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    cmc: 2,
    type_line,
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: {},
    ...overrides,
  } as ScryfallCard;
}

const forest = () => card('Forest', 'Basic Land — Forest');
const bear = () => card('Bear', 'Creature — Bear');
const opt = () => card('Opt', 'Instant'); // no tagger role → falls to synergy
const solRing = () => card('Sol Ring', 'Artifact'); // role resolves once taggerReady

function slots(cards: ScryfallCard[]): DeckDisplayCard[] {
  return cards.map((c, i) => ({ slotId: `slot-${i}`, card: c }));
}

function renderDeck(cards: DeckDisplayCard[], props: Partial<DeckDisplayProps> = {}) {
  return render(
    <MemoryRouter>
      <DeckDisplay title="Test deck" commander={null} format="commander" cards={cards} {...props} />
    </MemoryRouter>
  );
}

// Section title text, with the trailing "(N)" / "(N / T)" count stripped —
// callers that care about the count assert on container.textContent directly.
function sectionTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.deck-section-title')).map((el) => {
    const countEl = el.querySelector('.deck-section-count');
    const withoutCount = countEl
      ? el.textContent?.replace(countEl.textContent ?? '', '')
      : el.textContent;
    return withoutCount?.replace(/\s+/g, ' ').trim() ?? '';
  });
}

describe('DeckDisplay category groups (E124)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
    taggerReady = false;
  });

  it('defaults to type groups — the toggle default regression guard', () => {
    const { container } = renderDeck(slots([bear(), opt()]));
    const titles = sectionTitles(container);
    expect(titles).toContain('Creature');
    expect(titles).toContain('Instant');
    // Never a category-bucket title by default.
    expect(titles).not.toContain('Synergy');
  });

  it('category mode buckets a fixture deck into CATEGORY_DISPLAY_ORDER sections', () => {
    localStorage.setItem('mtg-decks-group-by', 'category');
    const { container } = renderDeck(slots([forest(), bear(), opt()]));
    const titles = sectionTitles(container);
    expect(titles).toEqual(['Lands', 'Creatures', 'Synergy']);
  });

  it('grid view renders the same category gauge in its own section header', () => {
    localStorage.setItem('mtg-decks-view-mode', 'grid');
    localStorage.setItem('mtg-decks-group-by', 'category');
    const { container } = renderDeck(slots([bear()]), {
      categoryTargets: { boardWipes: 3, creatures: 5 },
    });
    expect(container.textContent).toContain('(0 / 3)');
    expect(container.textContent).toContain('(1 / 5)');
    expect(container.querySelectorAll('[role="meter"]').length).toBeGreaterThan(0);
  });

  it('a 0-card bucket WITH a target renders 0/N; without a target renders nothing', () => {
    localStorage.setItem('mtg-decks-group-by', 'category');
    const { container } = renderDeck(slots([bear()]), {
      categoryTargets: { boardWipes: 3 }, // no board-wipe cards in the deck
    });
    const titles = sectionTitles(container);
    expect(titles.some((t) => t.startsWith('Board Wipe'))).toBe(true);
    expect(container.textContent).toContain('(0 / 3)');
    // singleRemoval has no target and no cards — must not render at all.
    expect(titles.some((t) => t.startsWith('Removal'))).toBe(false);
  });

  it('synergy/utility never render a MeterBar even when composition names all 8 buckets', () => {
    localStorage.setItem('mtg-decks-group-by', 'category');
    const fullComposition: Partial<Record<DeckCategory, number>> = {
      lands: 37,
      ramp: 10,
      cardDraw: 8,
      singleRemoval: 6,
      boardWipes: 3,
      creatures: 25,
      synergy: 10,
      utility: 1,
    };
    const { container } = renderDeck(slots([opt()]), { categoryTargets: fullComposition });

    const synergySection = Array.from(container.querySelectorAll('.deck-section')).find((s) =>
      s.querySelector('.deck-section-title')?.textContent?.startsWith('Synergy')
    );
    expect(synergySection).toBeTruthy();
    expect(synergySection?.querySelector('.deck-section-gauge')).toBeNull();
    expect(synergySection?.querySelector('[role="meter"]')).toBeNull();
    // The plain count still shows — just no "/ N" and no bar.
    expect(synergySection?.textContent).toContain('(1)');
  });

  it('re-buckets once when taggerReady flips true; a later unrelated prop change does not re-bucket', () => {
    localStorage.setItem('mtg-decks-group-by', 'category');
    const cards = slots([solRing(), opt()]);

    const { container, rerender } = renderDeck(cards);
    // Pre-taggerReady: Sol Ring has no resolvable role → synergy, alongside Opt.
    let titles = sectionTitles(container);
    expect(titles).toEqual(['Synergy']);

    taggerReady = true;
    rerender(
      <MemoryRouter>
        <DeckDisplay title="Test deck" commander={null} format="commander" cards={cards} />
      </MemoryRouter>
    );
    titles = sectionTitles(container);
    expect(titles).toEqual(expect.arrayContaining(['Ramp', 'Synergy']));

    // Unrelated derived-analysis prop change (bracketEstimation/roleTargets are
    // NOT in the grouping memo's deps) must not reshuffle the settled buckets.
    rerender(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={null}
          format="commander"
          cards={cards}
          roleTargets={{ ramp: 99 }}
        />
      </MemoryRouter>
    );
    titles = sectionTitles(container);
    expect(titles).toEqual(expect.arrayContaining(['Ramp', 'Synergy']));
  });
});
