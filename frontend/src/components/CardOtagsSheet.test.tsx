// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardOtagsSheet } from './CardOtagsSheet';

// Isolate from the snapshot fetch — the sheet only calls these three.
const readyRef = { value: true };
vi.mock('../lib/card-tags', () => ({
  useCardTagsReady: () => readyRef.value,
  getCardTags: (name: string) => (name === 'Sol Ring' ? ['mana-rock', 'ramp'] : []),
  cardTagLabel: (tag: string) => (tag === 'mana-rock' ? 'Mana rock' : 'Ramp'),
}));

afterEach(() => {
  vi.restoreAllMocks();
  readyRef.value = true;
});

const solRing = { name: 'Sol Ring', setCode: 'C21', collectorNumber: '263' };

describe('CardOtagsSheet', () => {
  it('lists the card’s tags as chips with descriptions', () => {
    render(<CardOtagsSheet card={solRing} onClose={() => {}} />);
    expect(screen.getByText('Mana rock')).toBeTruthy();
    expect(screen.getByText('Ramp')).toBeTruthy();
    expect(screen.getByText('Artifact that produces mana')).toBeTruthy();
    expect(screen.getByText('Accelerates your mana beyond one land per turn')).toBeTruthy();
  });

  it('links each tag to a Scryfall otag search in a new tab', () => {
    render(<CardOtagsSheet card={solRing} onClose={() => {}} />);
    const links = screen.getAllByRole('link', { name: /search on scryfall/i });
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('https://scryfall.com/search?q=otag%3Amana-rock');
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toContain('noopener');
  });

  it('builds the Tagger deep link from set code + collector number', () => {
    render(<CardOtagsSheet card={solRing} onClose={() => {}} />);
    const tagger = screen.getByRole('link', { name: /view this card on tagger/i });
    expect(tagger.getAttribute('href')).toBe('https://tagger.scryfall.com/card/c21/263');
  });

  it('omits the Tagger link when the printing identifiers are missing', () => {
    render(
      <CardOtagsSheet card={{ name: 'Sol Ring', setCode: '', collectorNumber: '' }} onClose={() => {}} />
    );
    expect(screen.queryByRole('link', { name: /view this card on tagger/i })).toBeNull();
  });

  it('shows the empty state for an untagged card', () => {
    render(
      <CardOtagsSheet
        card={{ name: 'Storm Crow', setCode: '9ed', collectorNumber: '100' }}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('No function tags in the local snapshot for this card.')).toBeTruthy();
  });

  it('shows a loading state until the snapshot is ready', () => {
    readyRef.value = false;
    render(<CardOtagsSheet card={solRing} onClose={() => {}} />);
    expect(screen.getByText('Loading tags…')).toBeTruthy();
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
    render(<CardOtagsSheet card={solRing} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
