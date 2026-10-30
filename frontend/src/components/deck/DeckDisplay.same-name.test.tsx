// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay } from './DeckDisplay';
import { buildFlatIndex, flatIndexOf } from './deck-display-derive';
import type { Row, TypedGroup } from './deck-display-rows';

// Guard: one name in two places. Odds & Ends' Yennett commands the deck as SLD
// #2121 and its display copy (#1019) rides In the box. The carousel, hover
// inspector and touch peek resolved a card by name, first entry wins, so the
// box card opened the commander's #2121 art.
vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));

const yennett = (id: string, cn: string): ScryfallCard =>
  ({
    id,
    oracle_id: 'oracle-yennett',
    name: 'Yennett, Cryptic Sovereign',
    mana_cost: '{2}{W}{U}{B}',
    cmc: 5,
    type_line: 'Legendary Creature — Sphinx',
    color_identity: ['W', 'U', 'B'],
    keywords: [],
    rarity: 'mythic',
    set: 'sld',
    collector_number: cn,
    set_name: 'Secret Lair Drop',
    image_uris: { normal: `https://img/${cn}.jpg`, large: `https://img/${cn}-large.jpg` },
    prices: { usd: '1.00' },
    legalities: {},
  }) as unknown as ScryfallCard;

const commander = yennett('sf-2121', '2121');
const display = yennett('sf-1019', '1019');

afterEach(cleanup);

describe('a name in the command zone and In the box', () => {
  it('flatIndexOf finds a row by its slot, and a slotless commander by name', () => {
    const row = (img: string, slotIds: string[]) =>
      ({ name: commander.name, card: commander, imageNormal: img, slotIds, qty: 1 }) as Row;
    const groups = (r: Row) => [{ title: 't', rows: [r] }] as unknown as TypedGroup[];
    const flat = buildFlatIndex(
      groups(row('cmd', [])),
      [],
      [],
      groups(row('box', ['box-slot'])),
      new Map()
    );
    expect(flat.rows[flatIndexOf(flat, commander.name, 'box-slot')!].imageNormal).toBe('box');
    expect(flat.rows[flatIndexOf(flat, commander.name)!].imageNormal).toBe('cmd');
  });

  it.each(['grid', 'list'] as const)('opening the box card shows its own art (%s)', (view) => {
    localStorage.setItem('mtg-decks-view-mode', view);
    const { container } = render(
      <MemoryRouter>
        <DeckDisplay
          title="Odds and Ends"
          commander={commander}
          format="commander"
          cards={[]}
          sideboard={[]}
          considering={[]}
          extras={[{ slotId: 'box', card: display }]}
        />
      </MemoryRouter>
    );
    const boxCard = container.querySelector('.deck-outzone [data-peek-slot="box"]')!;
    expect(boxCard).not.toBeNull();
    fireEvent.click(
      view === 'grid' ? boxCard : (boxCard.querySelector('button, [role="button"]') ?? boxCard)
    );
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const srcs = [...dialog!.querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '');
    expect(srcs.some((s) => s.includes('1019'))).toBe(true);
    expect(srcs.some((s) => s.includes('2121'))).toBe(false);
  });
});
