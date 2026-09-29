// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
/**
 * Guard for axe `nested-interactive` (WCAG 4.1.2): a control that holds
 * controls cannot be reached or announced by a screen reader. The collection
 * grid tile and the deck list row both used to be `role="button"` containers
 * around links, a qty button and a ⋮ menu; each is now a plain box whose
 * primary action is a real button stretched over it. This renders both with
 * their inner controls and fails on any nested-interactive violation, and on
 * the primary button losing its name or its click.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import type { EnrichedCard } from '@/types';
import type { ScryfallCard } from '@/deck-builder/types';
import { CardGridCell } from './shared/CardGridCell';
import { OverflowMenu } from './OverflowMenu';
import { DeckBadge } from './DeckBadge';
import { DeckDisplay, type DeckDisplayCard } from './deck/DeckDisplay';

vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

const runAxe = configureAxe({
  rules: {
    // Only the rule this file guards: the rest belong to a11y.smoke.test.tsx.
    'nested-interactive': { enabled: true },
  },
});

async function nestedViolations(node: HTMLElement) {
  const results = await runAxe(node, { runOnly: ['nested-interactive'] });
  return results.violations.filter((v) => v.id === 'nested-interactive');
}

const card = {
  copyId: 'c1',
  name: 'Sol Ring',
  setCode: 'cmm',
  rarity: 'uncommon',
  purchasePrice: 1,
  imageNormal: 'https://example.test/sol.jpg',
} as unknown as EnrichedCard;

describe('collection grid tile', () => {
  const renderTile = (props: Partial<React.ComponentProps<typeof CardGridCell>> = {}) =>
    render(
      <MemoryRouter>
        <CardGridCell
          card={card}
          qty={3}
          size="1x"
          onActivate={() => {}}
          menu={
            <OverflowMenu
              className="collection-grid-menu"
              triggerClassName="collection-grid-menu-btn"
              ariaLabel="Actions for Sol Ring"
              items={[{ label: 'Edit card', onClick: () => {} }]}
            />
          }
          badges={
            <DeckBadge
              allocations={[
                {
                  ownerKind: 'deck',
                  ownerId: 'd1',
                  ownerName: 'Mono Red',
                  ownerColor: '#c00',
                  href: '/decks/d1',
                } as never,
              ]}
              placement="art"
            />
          }
          {...props}
        />
      </MemoryRouter>
    );

  it('has no nested interactive controls with a menu and an identity link inside', async () => {
    const { container } = renderTile();
    // The link is really there, so the check is not passing on an empty tile.
    expect(screen.getByRole('link', { name: /Mono Red/ })).toBeTruthy();
    expect(await nestedViolations(container)).toEqual([]);
  });

  it('names the tile through its primary button and opens on click', () => {
    const onActivate = vi.fn();
    renderTile({ onActivate });
    const open = screen.getByRole('button', { name: 'Sol Ring, quantity 3' });
    expect(open.className).toContain('collection-grid-open');
    // The tile is a plain box: no role, no tab stop of its own.
    const tile = open.closest('.collection-grid-item')!;
    expect(tile.getAttribute('role')).toBeNull();
    expect(tile.getAttribute('tabindex')).toBeNull();
    fireEvent.click(open);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('reports selection on the primary button in select mode', () => {
    renderTile({ selectMode: true, selected: true });
    const open = screen.getByRole('button', { name: 'Sol Ring, quantity 3, selected' });
    expect(open.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('deck list row', () => {
  const bolt = {
    id: 'sf-bolt',
    oracle_id: 'o-bolt',
    name: 'Lightning Bolt',
    mana_cost: '{R}',
    cmc: 1,
    type_line: 'Instant',
    color_identity: ['R'],
    keywords: [],
    rarity: 'common',
    set: 'lea',
    collector_number: '161',
    set_name: 'Test Set',
    prices: { usd: '3.50' },
    legalities: {},
  } as unknown as ScryfallCard;
  const cards: DeckDisplayCard[] = [{ slotId: 's0', card: bolt }];

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
  });

  const renderDeck = () =>
    render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={null}
          format="standard"
          cards={cards}
          onSetQty={vi.fn()}
          onRemoveCard={vi.fn()}
        />
      </MemoryRouter>
    );

  it('has no nested interactive controls with a qty button and a ⋮ menu inside', async () => {
    const { container } = renderDeck();
    const row = container.querySelector('.deck-row') as HTMLElement;
    expect(row.querySelector('.deck-row-qty-edit')).not.toBeNull();
    expect(row.querySelector('.deck-row-menu-trigger')).not.toBeNull();
    expect(await nestedViolations(container)).toEqual([]);
  });

  it('names the row through its primary button, and the row is a plain box', () => {
    const { container } = renderDeck();
    const row = container.querySelector('.deck-row') as HTMLElement;
    expect(row.getAttribute('role')).toBeNull();
    expect(row.getAttribute('tabindex')).toBeNull();
    const open = screen.getByRole('button', { name: 'Lightning Bolt' });
    expect(open.parentElement).toBe(row);
  });

  it('opens the card preview when the primary button is clicked', () => {
    renderDeck();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Lightning Bolt' }));
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });
});
