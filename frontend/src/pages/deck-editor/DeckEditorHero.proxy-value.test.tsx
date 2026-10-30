// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Deck } from '@/store/decks';
import { DeckEditorHero } from './DeckEditorHero';

// The hero's value leaves proxies out (lib/deck/deck-value ownDeckValue) and
// says what it left out right beside it, so a deck that dropped in value when
// a card was marked doesn't read as a bug.

const deck = {
  id: 'd1',
  name: 'Kenrith',
  format: 'commander',
  source: 'manual',
  color: '#7a8a70',
  commander: null,
  partnerCommander: null,
  commanderAllocatedCopyId: null,
  partnerCommanderAllocatedCopyId: null,
  cards: [],
  sideboard: [],
  considering: [],
  generationContext: null,
  createdAt: 0,
  updatedAt: 0,
} as unknown as Deck;

function renderHero(proxied: number) {
  return render(
    <MemoryRouter>
      <DeckEditorHero
        deck={deck}
        art={undefined}
        formatConfig={null}
        heroTotals={{ count: 100, value: 372, proxied, sideboard: 0, considering: 0, extras: 0 }}
        bracketValue={undefined}
        heroBracket={undefined}
        commanderColorIdentity={[]}
        renaming={false}
        setRenaming={vi.fn()}
        onCommitRename={vi.fn()}
        updateDeck={vi.fn()}
        isDesktop
        isPhone={false}
        undoEdit={vi.fn()}
        redoEdit={vi.fn()}
        canUndoEdit={false}
        canRedoEdit={false}
        undoEditLabel={null}
        redoEditLabel={null}
        showAddPanel={false}
        onToggleAddPanel={vi.fn()}
        overflowMenu={null}
      />
    </MemoryRouter>
  );
}

describe('DeckEditorHero: value without proxies', () => {
  it('says what the proxies would add beside the value', () => {
    const { container } = renderHero(240);
    const text = container.querySelector('.deck-hero-totals')!.textContent!;
    expect(text).toContain('$372.00');
    // Non-breaking spaces hold the note together, so it wraps as one unit.
    expect(text).toContain('$240.00 in proxies not counted');
  });

  it('says nothing extra when the deck has no priced proxies', () => {
    const { container } = renderHero(0);
    expect(container.querySelector('.deck-hero-totals')!.textContent).not.toMatch(/proxies/);
    expect(screen.queryByText(/proxies/)).toBeNull();
  });
});
