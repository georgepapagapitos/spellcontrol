// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardOtagsSheet } from './CardOtagsSheet';

/** The tag chips are router Links (they open /tags), so the sheet needs a
 *  router context to render at all. */
const renderSheet = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

// Isolate from the snapshot fetch — the sheet only calls these five.
const readyRef = { value: true };
const errorRef = { value: false };
const ensureCardTags = vi.fn();
vi.mock('../lib/card-tags', () => ({
  useCardTagsReady: () => readyRef.value,
  useCardTagsError: () => errorRef.value,
  ensureCardTags: () => ensureCardTags(),
  getCardTags: (name: string) => (name === 'Sol Ring' ? ['mana-rock', 'ramp'] : []),
  cardTagLabel: (tag: string) => (tag === 'mana-rock' ? 'Mana rock' : 'Ramp'),
}));

afterEach(() => {
  vi.restoreAllMocks();
  readyRef.value = true;
  errorRef.value = false;
  ensureCardTags.mockClear();
});

const solRing = { name: 'Sol Ring', setCode: 'C21', collectorNumber: '263' };

describe('CardOtagsSheet', () => {
  it("lists the card's tags as chips with descriptions", () => {
    renderSheet(<CardOtagsSheet card={solRing} onClose={() => {}} />);
    expect(screen.getByText('Mana rock')).toBeTruthy();
    expect(screen.getByText('Ramp')).toBeTruthy();
    expect(screen.getByText('Artifact that produces mana')).toBeTruthy();
    expect(screen.getByText('Accelerates your mana beyond one land per turn')).toBeTruthy();
  });

  it('links each tag to a Scryfall otag search in a new tab', () => {
    renderSheet(<CardOtagsSheet card={solRing} onClose={() => {}} />);
    const links = screen.getAllByRole('link', { name: /search on scryfall/i });
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('https://scryfall.com/search?q=otag%3Amana-rock');
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toContain('noopener');
  });

  it('opens the in-app tag explorer from each chip, closing the sheet', () => {
    const onClose = vi.fn();
    renderSheet(<CardOtagsSheet card={solRing} onClose={onClose} />);
    const chip = screen.getByRole('link', { name: 'Browse every Mana rock card' });
    expect(chip.getAttribute('href')).toBe('/tags?t=mana-rock');
    fireEvent.click(chip);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('builds the Tagger deep link from set code + collector number', () => {
    renderSheet(<CardOtagsSheet card={solRing} onClose={() => {}} />);
    const tagger = screen.getByRole('link', { name: /view this card on tagger/i });
    expect(tagger.getAttribute('href')).toBe('https://tagger.scryfall.com/card/c21/263');
  });

  it('omits the Tagger link when the printing identifiers are missing', () => {
    renderSheet(
      <CardOtagsSheet
        card={{ name: 'Sol Ring', setCode: '', collectorNumber: '' }}
        onClose={() => {}}
      />
    );
    expect(screen.queryByRole('link', { name: /view this card on tagger/i })).toBeNull();
  });

  it('shows the empty state for an untagged card', () => {
    renderSheet(
      <CardOtagsSheet
        card={{ name: 'Storm Crow', setCode: '9ed', collectorNumber: '100' }}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('No function tags in the local snapshot for this card.')).toBeTruthy();
  });

  it('shows a loading state until the snapshot is ready', () => {
    readyRef.value = false;
    renderSheet(<CardOtagsSheet card={solRing} onClose={() => {}} />);
    expect(screen.getByText('Loading tags…')).toBeTruthy();
  });

  it('shows an error with retry when the snapshot fetch failed', () => {
    readyRef.value = false;
    errorRef.value = true;
    renderSheet(<CardOtagsSheet card={solRing} onClose={() => {}} />);
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load the tag snapshot.");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(ensureCardTags).toHaveBeenCalledTimes(1);
  });

  it('closes immediately on the desktop breakpoint (no exit keyframe there)', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('min-width: 1024px'),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList
    );
    const onClose = vi.fn();
    renderSheet(<CardOtagsSheet card={solRing} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
