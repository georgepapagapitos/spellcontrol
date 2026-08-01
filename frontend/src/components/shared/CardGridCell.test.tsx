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

  it('shows the proxy chip for a proxy card and not for a normal one, with an accessible name', () => {
    const proxyCard = { ...card, proxy: true };
    const { container, unmount } = render(
      <CardGridCell card={proxyCard} qty={1} size="1x" onActivate={() => {}} />
    );
    const badge = container.querySelector('.proxy-badge');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('aria-label')).toBe('Proxy');
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('proxy');
    unmount();

    render(<CardGridCell card={card} qty={1} size="1x" onActivate={() => {}} />);
    expect(document.querySelector('.proxy-badge')).toBeNull();
  });
});

const componentsDir = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(componentsDir, '..', f), 'utf8');

describe('guard: every card grid renders the shared tile', () => {
  it.each([['CardListTable.tsx'], ['ListDetailView.tsx']])('%s uses CardGridCell', (file) => {
    expect(
      read(file),
      `${file} must render <CardGridCell />, not its own tile markup — a private tile is how the lists grid lost its set + price captions`
    ).toContain('<CardGridCell');
  });

  it('lists no longer ships a private grid tile', () => {
    expect(
      read('ListDetailView.tsx'),
      'The bespoke .list-entries-grid-cell tile is gone; only the skeleton placeholder keeps that class'
    ).not.toMatch(/className="list-entries-grid-cell"/);
  });
});
