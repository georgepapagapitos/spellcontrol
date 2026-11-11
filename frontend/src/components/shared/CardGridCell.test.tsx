// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { EnrichedCard } from '../../types';
import { CardGridCell, gridSetLabel, type GridCaptionPrefs } from './CardGridCell';

/**
 * `CardGridCell` is the grid twin of `CardRow`: one tile shared by every grid
 * surface. It exists because the lists grid shipped as its own bespoke tile
 * (art + ×qty only) and silently missed the set + price caption plate the
 * collection grid had — the same drift `CardRow` was extracted to end (E211).
 */

const card = {
  copyId: 'c1',
  name: 'Sol Ring',
  setCode: 'cmr',
  setName: 'Commander Legends',
  collectorNumber: '472',
  rarity: 'uncommon',
  scryfallId: 'sf-1',
  purchasePrice: 1.75,
  sourceCategory: '',
  sourceFormat: 'list',
  finish: 'nonfoil',
  foil: false,
  imageNormal: 'https://cards.test/sol-ring.jpg',
} as unknown as EnrichedCard;

const ON: GridCaptionPrefs = { sortValue: true, set: true };
const OFF: GridCaptionPrefs = { sortValue: false, set: false };

describe('CardGridCell captions', () => {
  it('renders the price and set lines under the tile', () => {
    render(
      <CardGridCell
        card={card}
        qty={1}
        size="1x"
        caption="$1.75"
        setLabel={gridSetLabel(card, ON)}
        onActivate={() => {}}
      />
    );
    expect(document.querySelector('.collection-grid-caption')?.textContent).toBe('$1.75');
    expect(document.querySelector('.collection-grid-caption--set')?.textContent).toContain(
      'CMR · 472'
    );
  });

  it('drops the caption plate entirely when both lines are off', () => {
    render(
      <CardGridCell
        card={card}
        qty={1}
        size="1x"
        caption={null}
        setLabel={gridSetLabel(card, OFF)}
        onActivate={() => {}}
      />
    );
    expect(document.querySelector('.collection-grid-captions')).toBeNull();
    // The set line carries rarity (tinted glyph); without it the on-card
    // rarity badge comes back rather than the rarity going unreadable.
    expect(document.querySelector('.collection-grid-rarity')).not.toBeNull();
  });

  it('suppresses the on-card rarity badge while the set line shows it', () => {
    render(
      <CardGridCell
        card={card}
        qty={3}
        size="1x"
        setLabel={gridSetLabel(card, ON)}
        onActivate={() => {}}
      />
    );
    expect(document.querySelector('.collection-grid-rarity')).toBeNull();
    expect(document.querySelector('.collection-grid-qty')?.textContent).toContain('3');
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('CMR · 472');
  });

  it('marks a proxy card and not a normal one, and names it proxy', () => {
    const proxyCard = { ...card, proxy: true };
    const { container, unmount } = render(
      <CardGridCell card={proxyCard} qty={1} size="1x" onActivate={() => {}} />
    );
    expect(container.querySelector('.art-proxy')?.textContent).toBe('Proxy');
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('proxy');
    unmount();

    render(<CardGridCell card={card} qty={1} size="1x" onActivate={() => {}} />);
    expect(document.querySelector('.art-proxy')).toBeNull();
  });

  it('shows the manual-price-override chip for an overridden card, with an accessible name (E204)', () => {
    const overriddenCard = { ...card, priceOverride: 25 };
    const { container, unmount } = render(
      <CardGridCell
        card={overriddenCard}
        qty={1}
        size="1x"
        caption="$25.00"
        priceCaption
        onActivate={() => {}}
      />
    );
    const badge = container.querySelector('.price-override-badge');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('aria-label')).toBe('Manually priced');
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('manually priced');
    unmount();

    render(
      <CardGridCell
        card={card}
        qty={1}
        size="1x"
        caption="$1.75"
        priceCaption
        onActivate={() => {}}
      />
    );
    expect(document.querySelector('.price-override-badge')).toBeNull();
  });
});

const componentsDir = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(componentsDir, '..', f), 'utf8');

describe('guard: every card grid renders the shared tile', () => {
  it.each([
    ['collection/CardListGridCell.tsx'],
    ['lists/ListDetailView.tsx'],
    ['../pages/cube/CubeResult.tsx'],
  ])('%s uses CardGridCell', (file) => {
    expect(
      read(file),
      `${file} must render <CardGridCell />, not its own tile markup — a private tile is how the lists grid lost its set + price captions`
    ).toContain('<CardGridCell');
  });

  it('lists no longer ships a private grid tile', () => {
    expect(
      read('lists/ListDetailView.tsx'),
      'The bespoke .list-entries-grid-cell tile is gone; only the skeleton placeholder keeps that class'
    ).not.toMatch(/className="list-entries-grid-cell"/);
  });
});

describe('CardGridCell proxy and manual-price marks', () => {
  // The proxy mark was a loose "P" chip: first pushed in off the ⋮ onto the
  // name line, then a line of its own above the plate. It is a segment of
  // the tile's one plate now, so it costs no width or line of its own.
  const proxy = { ...card, proxy: true, priceOverride: 2 } as EnrichedCard;

  it('opens the corner with a Proxy segment when no plate holds the corner', () => {
    render(
      <CardGridCell
        card={proxy}
        qty={2}
        size="1x"
        caption="$2.00"
        setLabel={null}
        onActivate={() => {}}
      />
    );
    const corner = document.querySelector('.collection-grid-corner');
    expect(corner?.firstElementChild?.textContent).toBe('Proxy');
    expect(document.querySelector('.proxy-badge')).toBeNull();
  });

  it('leaves the segment to the plate when the plate holds the corner', () => {
    render(
      <CardGridCell
        card={proxy}
        qty={2}
        size="1x"
        caption={null}
        setLabel={null}
        badges={<span className="plate-stub" />}
        badgesHoldCorner
        onActivate={() => {}}
      />
    );
    expect(document.querySelector('.collection-grid-corner')).toBeNull();
    expect(document.querySelector('.art-proxy')).toBeNull();
  });

  it('marks a manual price with a pencil on a price caption, and nowhere else', () => {
    const { rerender } = render(
      <CardGridCell
        card={proxy}
        qty={1}
        size="1x"
        caption="$2.00"
        priceCaption
        setLabel={null}
        onActivate={() => {}}
      />
    );
    const pencil = document.querySelector('.collection-grid-caption .price-override-badge--pencil');
    expect(pencil?.getAttribute('aria-label')).toMatch(/Manually priced/);
    rerender(
      <CardGridCell
        card={proxy}
        qty={1}
        size="1x"
        caption="Nov 6, 2026"
        setLabel={null}
        onActivate={() => {}}
      />
    );
    expect(document.querySelector('.price-override-badge')).toBeNull();
  });
});
