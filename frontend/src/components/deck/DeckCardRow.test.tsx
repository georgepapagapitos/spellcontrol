// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeckCardRow } from './DeckCardRow';
import type { Change } from '@/lib/deck-change';

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
    expect(screen.getByText('In other deck')).toBeTruthy();
  });

  it('renders the Game Changer + Synergy tags from flags', () => {
    render(<DeckCardRow change={add({ isGameChanger: true, isThemeSynergy: true })} />);
    expect(screen.getByText('Game Changer')).toBeTruthy();
    expect(screen.getByText('Synergy')).toBeTruthy();
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
});
