// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeckCardRow } from './DeckCardRow';
import type { Change } from '@/lib/coach/deck-change';
import { useCollectionStore } from '@/store/collection';
import { bestOwnedCopyByName } from '@/lib/cards/owned-printing';

function add(over: Partial<Change> = {}): Change {
  return {
    id: 'upgrade:Sol Ring',
    type: 'add',
    lane: 'upgrade',
    name: 'Sol Ring',
    reason: 'fast mana',
    ...over,
  };
}

describe('DeckCardRow', () => {
  it('renders the name and reason, without a redundant verdict chip', () => {
    render(<DeckCardRow change={add()} />);
    expect(screen.getByText('Sol Ring')).toBeTruthy();
    expect(screen.getByText('fast mana')).toBeTruthy();
    // The verdict chip is gone — the action button / section header carry the verb.
    expect(screen.queryByText('Add')).toBeNull();
  });

  it('shows the inclusion read-out (with a tinted %) when inclusion is a number', () => {
    const { container } = render(
      <DeckCardRow change={add({ inclusion: 87 })} commanderName="Atraxa" />
    );
    expect(
      container.querySelector('.deck-card-row-incl')?.textContent?.replace(/\s+/g, ' ').trim()
    ).toBe('In 87% of Atraxa decks');
    // The percentage itself is the tinted signal (replaces the old separate bar).
    expect(container.querySelector('.deck-card-row-incl-pct')?.textContent).toBe('87%');
  });

  // E415: EDHREC's synergy is a -1..1 fraction. The row printed
  // `+${Math.round(synergy)}% synergy`, so every card read "+0% synergy".
  it('shows synergy as a chip with the real percent, and never "+0%"', () => {
    const { container, unmount } = render(<DeckCardRow change={add({ synergy: 0.34 })} />);
    expect(screen.getByText('Synergy +34%')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\+0%/);
    unmount();
    const sliver = render(<DeckCardRow change={add({ synergy: 0.003 })} />);
    expect(sliver.container.textContent).not.toMatch(/synergy|\+0%/i);
    sliver.unmount();
    render(<DeckCardRow change={add({ synergy: -0.2, isThemeSynergy: true })} />);
    expect(screen.getByText('Synergy')).toBeTruthy();
  });

  it('shows the art crop when asked, for the Coach table', () => {
    const { container } = render(
      <DeckCardRow
        artThumb
        change={add({ imageUrl: 'https://cards.scryfall.io/normal/front/a/b/sol.jpg' })}
      />
    );
    expect(container.querySelector('.deck-card-row-art--crop img')?.getAttribute('src')).toBe(
      'https://cards.scryfall.io/art_crop/front/a/b/sol.jpg'
    );
  });

  it('renders "Off-meta" when inclusion is undefined', () => {
    render(<DeckCardRow change={add({ inclusion: undefined })} />);
    expect(screen.getByText('Off-meta')).toBeTruthy();
  });

  it('shows the Owned badge only for owned cards', () => {
    const { unmount } = render(<DeckCardRow change={add({ ownership: 'owned' })} />);
    expect(screen.getByText('Owned')).toBeTruthy();
    unmount();
    render(<DeckCardRow change={add({ ownership: 'unowned' })} />);
    expect(screen.queryByText('Owned')).toBeNull();
  });

  it('renders the muted "In other deck" chip for claimed-elsewhere copies', () => {
    render(<DeckCardRow change={add({ ownership: 'in-other-deck' })} />);
    const chip = screen.getByText('In other deck').closest('.verdict-chip')!;
    expect(chip).toBeTruthy();
    // Shared VerdictBadge chip, neutral tone — not a hand-rolled pill.
    expect(chip.classList.contains('verdict-chip')).toBe(true);
    expect(chip.getAttribute('data-tone')).toBe('neutral');
  });

  it('renders the Game Changer + Synergy tags as shared VerdictBadge chips', () => {
    render(<DeckCardRow change={add({ isGameChanger: true, isThemeSynergy: true })} />);
    const gc = screen.getByText('Game Changer').closest('.verdict-chip')!;
    expect(gc.classList.contains('verdict-chip')).toBe(true);
    expect(gc.getAttribute('data-tone')).toBe('warn');
    expect(gc.getAttribute('title')).toContain('bracket-relevant');
    const syn = screen.getByText('Synergy').closest('.verdict-chip')!;
    expect(syn.classList.contains('verdict-chip')).toBe(true);
    expect(syn.getAttribute('data-tone')).toBe('accent');
  });

  it('renders the budget confidence tier as a toned VerdictBadge chip', () => {
    const { unmount } = render(
      <DeckCardRow change={add({ lane: 'budget', confidence: 'drop-in', reason: undefined })} />
    );
    const dropIn = screen.getByText('Drop-in').closest('.verdict-chip')!;
    expect(dropIn.classList.contains('verdict-chip')).toBe(true);
    expect(dropIn.getAttribute('data-tone')).toBe('success');
    unmount();

    render(
      <DeckCardRow change={add({ lane: 'budget', confidence: 'budget', reason: undefined })} />
    );
    const budget = screen.getByText('Budget').closest('.verdict-chip')!;
    expect(budget.getAttribute('data-tone')).toBe('warn');
  });

  it('shows no confidence chip for non-budget lanes', () => {
    render(<DeckCardRow change={add({ lane: 'upgrade', confidence: 'drop-in' })} />);
    expect(screen.queryByText('Drop-in')).toBeNull();
  });

  it('renders the role label as a neutral VerdictBadge chip', () => {
    render(<DeckCardRow change={add({ roleLabel: 'Ramp' })} />);
    const role = screen.getByText('Ramp').closest('.verdict-chip')!;
    expect(role.classList.contains('verdict-chip')).toBe(true);
    expect(role.getAttribute('data-tone')).toBe('neutral');
  });

  it('formats a signed acquire price', () => {
    render(<DeckCardRow change={add({ deltaPrice: 4.5 })} />);
    expect(screen.getByText('+$4.50')).toBeTruthy();
  });

  it('fires onAct with the change and respects the action label + acting state', () => {
    const onAct = vi.fn();
    const { unmount } = render(<DeckCardRow change={add()} onAct={onAct} actLabel="Swap in" />);
    const btn = screen.getByText('Swap in').closest('button')!;
    fireEvent.click(btn);
    expect(onAct).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sol Ring' }));
    unmount();

    const { container } = render(<DeckCardRow change={add()} onAct={onAct} acting />);
    const actBtn = container.querySelector('.deck-card-row-act') as HTMLButtonElement;
    expect(actBtn.disabled).toBe(true);
  });

  it('names the in-flight action in real words, never verb + "ing"', () => {
    const cases: Array<[Partial<Change>, string | undefined, string]> = [
      [{}, undefined, 'Adding Sol Ring'],
      [{ type: 'cut' }, undefined, 'Cutting Sol Ring'],
      [{ type: 'swap', inName: 'Mind Stone' }, undefined, 'Swapping Sol Ring'],
      [{}, 'Move in', 'Move in Sol Ring, in progress'],
    ];
    for (const [over, actLabel, name] of cases) {
      const { unmount } = render(
        <DeckCardRow change={add(over)} onAct={vi.fn()} actLabel={actLabel} acting />
      );
      expect(screen.getByRole('button', { name })).toBeTruthy();
      unmount();
    }
  });

  it('fires onPreview only from the thumbnail (not the row body)', () => {
    const onPreview = vi.fn();
    const { container } = render(
      <DeckCardRow change={add()} onPreview={onPreview} peekName="Sol Ring" />
    );
    // The body is non-interactive — clicking the name must NOT preview.
    fireEvent.click(screen.getByText('Sol Ring'));
    expect(onPreview).not.toHaveBeenCalled();
    // Only the thumbnail opens the preview.
    fireEvent.click(screen.getByLabelText('Preview Sol Ring'));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sol Ring' }));
    // The body carries no data-peek-name; only the thumbnail does (hover-peek).
    expect(container.querySelector('.deck-card-row-art')?.getAttribute('data-peek-name')).toBe(
      'Sol Ring'
    );
  });

  it('renders no action button when onAct is omitted', () => {
    render(<DeckCardRow change={add()} />);
    expect(screen.queryByText('Add', { selector: '.deck-card-row-act' })).toBeNull();
  });

  it('renders a secondary action button when secondaryAction is provided', () => {
    const onClick = vi.fn();
    render(
      <DeckCardRow
        change={add()}
        secondaryAction={{ label: 'Fit?', ariaLabel: 'Will Sol Ring fit this deck?', onClick }}
      />
    );
    const btn = screen.getByRole('button', { name: 'Will Sol Ring fit this deck?' });
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('Fit?');
  });

  it('fires the secondaryAction onClick when clicked', () => {
    const onClick = vi.fn();
    render(
      <DeckCardRow
        change={add()}
        secondaryAction={{ label: 'Fit?', ariaLabel: 'Will Sol Ring fit this deck?', onClick }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Will Sol Ring fit this deck?' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not render a secondary action button when secondaryAction is omitted', () => {
    render(<DeckCardRow change={add()} />);
    expect(screen.queryByRole('button', { name: /fit this deck/ })).toBeNull();
  });
});

// The row and the carousel it opens pick a printing by one rule
// (`bestOwnedCopyByName`): an owned Secret Lair copy showed its own art in the
// preview while the row showed Scryfall's default printing.
describe('DeckCardRow thumbnail printing', () => {
  const sld = {
    copyId: 'c1',
    name: 'Tireless Provisioner',
    setCode: 'sld',
    setName: 'Secret Lair Drop',
    collectorNumber: '2661',
    rarity: 'rare',
    scryfallId: 'ab12cd34-0000-0000-0000-000000000000',
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: '',
    finish: 'foil' as const,
    foil: true,
    imageNormal: 'https://cards.scryfall.io/normal/front/a/b/ab12cd34.jpg?1',
  };
  afterEach(() => useCollectionStore.setState({ cards: [] }));

  it('shows the owned printing the preview opens on, over the default art', () => {
    useCollectionStore.setState({ cards: [sld] });
    const { container } = render(
      <DeckCardRow
        artThumb
        change={add({
          name: 'Tireless Provisioner',
          imageUrl: 'https://cards.scryfall.io/normal/front/d/e/default.jpg',
        })}
      />
    );
    expect(container.querySelector('.deck-card-row-art img')?.getAttribute('src')).toBe(
      'https://cards.scryfall.io/art_crop/front/a/b/ab12cd34.jpg?1'
    );
    // The carousel resolves through the same function, so it opens on this copy.
    expect(bestOwnedCopyByName('Tireless Provisioner')?.scryfallId).toBe(sld.scryfallId);
  });

  it('builds the owned art from the printing id when the copy stored no image', () => {
    useCollectionStore.setState({ cards: [{ ...sld, imageNormal: undefined }] });
    const { container } = render(<DeckCardRow change={add({ name: 'Tireless Provisioner' })} />);
    expect(container.querySelector('.deck-card-row-art img')?.getAttribute('src')).toBe(
      `https://cards.scryfall.io/normal/front/a/b/${sld.scryfallId}.jpg`
    );
  });

  it('keeps the carried art for a card the player does not own', () => {
    const { container } = render(
      <DeckCardRow change={add({ imageUrl: 'https://cards.scryfall.io/normal/front/d/e/x.jpg' })} />
    );
    expect(container.querySelector('.deck-card-row-art img')?.getAttribute('src')).toBe(
      'https://cards.scryfall.io/normal/front/d/e/x.jpg'
    );
  });
});
