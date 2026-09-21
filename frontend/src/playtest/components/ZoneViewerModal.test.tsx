// @vitest-environment happy-dom
/**
 * B6-07: the zone browser had no path from a card to its full text — tapping
 * a card face now opens the shared `CardPreview`, same wiring OpeningHandSheet
 * already has. CardPreview itself is stubbed (own test file, large dependency
 * tree) — these tests only exercise ZoneViewerModal's hand-off: which card,
 * at which index, and that a card with no lookup entry stays a plain image.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { PlaytestCard } from '@/lib/playtest';
import { ZoneViewerModal } from './ZoneViewerModal';

vi.mock('@/components/CardPreview', () => ({
  CardPreview: (props: { cards: Array<{ name: string }>; index: number }) => (
    <div data-testid="card-preview">{props.cards[props.index]?.name}</div>
  ),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

function scryCard(id: string, name: string): ScryfallCard {
  return {
    id,
    name,
    set: 'tst',
    set_name: 'Test Set',
    collector_number: '1',
    rarity: 'common',
    type_line: 'Creature — Test',
    cmc: 1,
  } as unknown as ScryfallCard;
}

function ptCard(id: string, name: string): PlaytestCard {
  return { id, name };
}

describe('ZoneViewerModal — tap-to-preview (B6-07)', () => {
  it('opens CardPreview at the tapped card, indexed only over previewable cards', () => {
    const cards = [ptCard('c1', 'Sol Ring'), ptCard('c2', 'Arcane Signet')];
    const cardLookup = new Map([['c2', scryCard('c2', 'Arcane Signet')]]);
    render(
      <ZoneViewerModal
        zone="library"
        cards={cards}
        onClose={() => {}}
        onMove={() => {}}
        cardLookup={cardLookup}
      />
    );

    expect(screen.queryByTestId('card-preview')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Arcane Signet: preview' }));
    expect(screen.getByTestId('card-preview').textContent).toBe('Arcane Signet');
  });

  it('renders a plain, non-interactive face for a card with no lookup entry', () => {
    const cards = [ptCard('c1', 'Sol Ring')];
    render(<ZoneViewerModal zone="library" cards={cards} onClose={() => {}} onMove={() => {}} />);
    expect(screen.queryByRole('button', { name: /preview/ })).toBeNull();
  });
});

describe('ZoneViewerModal — one primary action per tile, not a stacked list', () => {
  it('library: primary is "To hand", Top badge on the first (array-order) card', () => {
    const cards = [ptCard('c1', 'Sol Ring'), ptCard('c2', 'Arcane Signet')];
    render(<ZoneViewerModal zone="library" cards={cards} onClose={() => {}} onMove={() => {}} />);
    expect(screen.getByText('Top of your library first.')).toBeTruthy();
    const primaries = screen.getAllByRole('button', { name: 'To hand' });
    expect(primaries.length).toBe(2);
    // Only the first (top) card gets the badge.
    expect(screen.getAllByText('Top').length).toBe(1);
  });

  it('graveyard/exile render most-recent-first (reversed) with a Top badge', () => {
    const cards = [ptCard('c1', 'Oldest'), ptCard('c2', 'Newest')];
    const { container } = render(
      <ZoneViewerModal zone="graveyard" cards={cards} onClose={() => {}} onMove={() => {}} />
    );
    expect(screen.getByText('Most recent on top.')).toBeTruthy();
    const names = Array.from(container.querySelectorAll('.playtest-zone-card__name')).map(
      (el) => el.textContent
    );
    expect(names).toEqual(['Newest', 'Oldest']);
  });

  it('command zone: primary reads "Cast (+N)" and shows "Tax +N" only when tax > 0', () => {
    const cards = [ptCard('c1', 'Atraxa'), ptCard('c2', 'Krenko')];
    render(
      <ZoneViewerModal
        zone="command"
        cards={cards}
        commanderTax={{ c1: 2 }} // ×2 in commanderTaxAmount → 4
        onClose={() => {}}
        onMove={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: 'Cast (+4)' })).toBeTruthy();
    expect(screen.getByText('Tax +4')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cast' })).toBeTruthy(); // c2, no tax
    // No order badge/hint in the command zone.
    expect(screen.queryByText('Top')).toBeNull();
  });

  it('the primary button dispatches the right move without opening the overflow', () => {
    const onMove = vi.fn();
    const cards = [ptCard('c1', 'Sol Ring')];
    render(<ZoneViewerModal zone="library" cards={cards} onClose={() => {}} onMove={onMove} />);
    fireEvent.click(screen.getByRole('button', { name: 'To hand' }));
    expect(onMove).toHaveBeenCalledWith('c1', 'hand', undefined);
  });

  it('the overflow menu offers every other destination, minus the zone itself and the primary', () => {
    const cards = [ptCard('c1', 'Atraxa')];
    render(<ZoneViewerModal zone="command" cards={cards} onClose={() => {}} onMove={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Atraxa' }));
    for (const label of ['Hand', 'Graveyard', 'Exile', 'Library (top)', 'Library (bottom)']) {
      expect(screen.getByRole('menuitem', { name: label })).toBeTruthy();
    }
    // "Battlefield" (the primary, "Cast") and "Command" (the zone itself) are
    // not duplicated in the overflow.
    expect(screen.queryByRole('menuitem', { name: 'Battlefield' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Command' })).toBeNull();
  });
});

describe('ZoneViewerModal — empty vs no-match states', () => {
  it('shows the zone-specific empty message when the zone has no cards', () => {
    render(<ZoneViewerModal zone="graveyard" cards={[]} onClose={() => {}} onMove={() => {}} />);
    expect(screen.getByText('Your graveyard is empty.')).toBeTruthy();
  });

  it('shows a no-match message with a Clear search button when a filter matches nothing', () => {
    const cards = [ptCard('c1', 'Sol Ring')];
    render(<ZoneViewerModal zone="library" cards={cards} onClose={() => {}} onMove={() => {}} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search Library' }), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText('No cards match “zzz”.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search filter' }));
    expect(screen.getByRole('button', { name: 'To hand' })).toBeTruthy();
  });
});

describe('ZoneViewerModal — footer', () => {
  it('library: Done + Shuffle and close', () => {
    const onShuffleAfter = vi.fn();
    render(
      <ZoneViewerModal
        zone="library"
        cards={[ptCard('c1', 'Sol Ring')]}
        onClose={() => {}}
        onMove={() => {}}
        onShuffleAfter={onShuffleAfter}
      />
    );
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle and close' }));
    expect(onShuffleAfter).toHaveBeenCalled();
  });

  it('graveyard: Shuffle into library, disabled when empty', () => {
    const onShuffleIntoLibrary = vi.fn();
    const { rerender } = render(
      <ZoneViewerModal
        zone="graveyard"
        cards={[]}
        onClose={() => {}}
        onMove={() => {}}
        onShuffleIntoLibrary={onShuffleIntoLibrary}
      />
    );
    expect(
      (screen.getByRole('button', { name: 'Shuffle into library' }) as HTMLButtonElement).disabled
    ).toBe(true);

    rerender(
      <ZoneViewerModal
        zone="graveyard"
        cards={[ptCard('c1', 'Sol Ring')]}
        onClose={() => {}}
        onMove={() => {}}
        onShuffleIntoLibrary={onShuffleIntoLibrary}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle into library' }));
    expect(onShuffleIntoLibrary).toHaveBeenCalled();
  });

  it('command zone: Done only, no shuffle buttons', () => {
    render(
      <ZoneViewerModal
        zone="command"
        cards={[ptCard('c1', 'Atraxa')]}
        onClose={() => {}}
        onMove={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Shuffle/ })).toBeNull();
  });
});

/**
 * The other side of face-down exile: its owner CAN read it — you know what
 * you exiled — and needs to be told the table cannot.
 */
describe('ZoneViewerModal — your own face-down exile', () => {
  it('shows the card, badged as face down', () => {
    const cards = [ptCard('a', 'Hidden Thing'), ptCard('b', 'Open Thing')];
    render(
      <ZoneViewerModal
        zone="exile"
        cards={cards}
        hiddenIds={new Set(['a'])}
        onClose={() => {}}
        onMove={() => {}}
      />
    );
    // Readable to you, both of them (the name appears on the tile and in
    // its placeholder, hence getAllByText).
    expect(screen.getAllByText('Hidden Thing').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Open Thing').length).toBeGreaterThan(0);
    // And exactly one is marked as hidden from everyone else.
    expect(screen.getAllByText('Face down')).toHaveLength(1);
  });

  it('badges nothing when nothing is hidden', () => {
    render(
      <ZoneViewerModal
        zone="exile"
        cards={[ptCard('a', 'Open Thing')]}
        onClose={() => {}}
        onMove={() => {}}
      />
    );
    expect(screen.queryByText('Face down')).toBeNull();
  });
});
