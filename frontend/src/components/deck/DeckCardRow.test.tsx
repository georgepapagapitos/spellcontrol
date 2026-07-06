// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeckCardRow, inclusionColor } from './DeckCardRow';
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
    const chip = screen.getByText('In other deck');
    expect(chip).toBeTruthy();
    // Shared VerdictBadge chip, neutral tone — not a hand-rolled pill.
    expect(chip.classList.contains('verdict-chip')).toBe(true);
    expect(chip.classList.contains('is-neutral')).toBe(true);
  });

  it('renders the Game Changer + Synergy tags as shared VerdictBadge chips', () => {
    render(<DeckCardRow change={add({ isGameChanger: true, isThemeSynergy: true })} />);
    const gc = screen.getByText('Game Changer');
    expect(gc.classList.contains('verdict-chip')).toBe(true);
    expect(gc.classList.contains('is-warn')).toBe(true);
    expect(gc.getAttribute('title')).toContain('bracket-relevant');
    const syn = screen.getByText('Synergy');
    expect(syn.classList.contains('verdict-chip')).toBe(true);
    expect(syn.classList.contains('is-accent')).toBe(true);
  });

  it('renders the budget confidence tier as a toned VerdictBadge chip', () => {
    const { unmount } = render(
      <DeckCardRow change={add({ lane: 'budget', confidence: 'drop-in', reason: undefined })} />
    );
    const dropIn = screen.getByText('Drop-in');
    expect(dropIn.classList.contains('verdict-chip')).toBe(true);
    expect(dropIn.classList.contains('is-success')).toBe(true);
    unmount();

    render(
      <DeckCardRow change={add({ lane: 'budget', confidence: 'budget', reason: undefined })} />
    );
    const budget = screen.getByText('Budget');
    expect(budget.classList.contains('is-warn')).toBe(true);
  });

  it('shows no confidence chip for non-budget lanes', () => {
    render(<DeckCardRow change={add({ lane: 'upgrade', confidence: 'drop-in' })} />);
    expect(screen.queryByText('Drop-in')).toBeNull();
  });

  it('renders the role label as a neutral VerdictBadge chip', () => {
    render(<DeckCardRow change={add({ roleLabel: 'Ramp' })} />);
    const role = screen.getByText('Ramp');
    expect(role.classList.contains('verdict-chip')).toBe(true);
    expect(role.classList.contains('is-neutral')).toBe(true);
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

describe('inclusionColor', () => {
  const hueOf = (color: string): number => {
    const m = /^hsl\((\d+) 60% 45%\)$/.exec(color);
    expect(m, `unexpected color format: ${color}`).toBeTruthy();
    return Number(m![1]);
  };

  it('never renders red — even a 1% "deep cut" reads as amber, not an alarm', () => {
    // classifyInclusion never lets a real signal below 1% reach inclusionColor
    // (0/no-signal renders "Off-meta" instead), so the low end only needs to
    // read as a spicy pick, not an error.
    expect(hueOf(inclusionColor(1))).toBeGreaterThanOrEqual(35);
    expect(hueOf(inclusionColor(5))).toBeGreaterThanOrEqual(35);
    expect(hueOf(inclusionColor(9))).toBeGreaterThanOrEqual(35);
  });

  it('reads amber/neutral for low-mid percentages', () => {
    expect(hueOf(inclusionColor(10))).toBeGreaterThanOrEqual(35);
    expect(hueOf(inclusionColor(35))).toBeGreaterThanOrEqual(35); // 35% is NOT red
    expect(hueOf(inclusionColor(35))).toBeLessThan(60); // …and not yet green
    expect(hueOf(inclusionColor(49))).toBeLessThan(60);
  });

  it('keeps the high-% green ramp unchanged from the old scale (hue = 1.2 × pct)', () => {
    expect(inclusionColor(50)).toBe('hsl(60 60% 45%)');
    expect(inclusionColor(75)).toBe('hsl(90 60% 45%)');
    expect(inclusionColor(90)).toBe('hsl(108 60% 45%)');
    expect(inclusionColor(100)).toBe('hsl(120 60% 45%)');
  });

  it('clamps out-of-range input', () => {
    expect(inclusionColor(-5)).toBe(inclusionColor(0));
    expect(inclusionColor(140)).toBe(inclusionColor(100));
  });
});
