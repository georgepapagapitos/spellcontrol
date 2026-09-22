// @vitest-environment happy-dom
/**
 * The narrow tier's stand-in for the four zone piles. It carried its own
 * hand-rolled three-item list (Browse / Shuffle / Top cards) while the table
 * tier's pile menu grew to ten rows — a phone has no right-click, but it has
 * no reason to be offered fewer actions either. The kebab now hands the zone
 * up and the board renders the SAME menu as a bottom sheet, so these tests
 * pin the hand-off rather than a duplicate list.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { PlaytestCard, Zone } from '@/lib/playtest';
import { MobileZonesPanel } from './MobileZonesPanel';

function card(id: string): PlaytestCard {
  return { id, name: `Card ${id}` };
}

const ZONES: Record<Zone, PlaytestCard[]> = {
  library: [card('a'), card('b')],
  hand: [],
  graveyard: [card('c')],
  exile: [],
  command: [],
};

function renderPanel(overrides: Partial<Parameters<typeof MobileZonesPanel>[0]> = {}) {
  const onOpenZone = vi.fn();
  const onMenu = vi.fn();
  render(
    <MobileZonesPanel
      zones={ZONES}
      commanderTax={{}}
      onOpenZone={onOpenZone}
      onMenu={onMenu}
      {...overrides}
    />
  );
  return { onOpenZone, onMenu };
}

function openDrawer() {
  fireEvent.click(screen.getByRole('button', { name: 'Show exile and the command zone' }));
}

describe('MobileZonesPanel', () => {
  /* The tab holds the two zones the phone's corner row has no width for.
     The library and the graveyard stand on the felt beside the hand now, so
     listing them here too would be the same pile in two places. */
  it('holds exile and the command zone, and leaves the felt its two piles', () => {
    renderPanel();
    expect(screen.queryByRole('region', { name: 'Exile and the command zone' })).toBeNull();
    openDrawer();

    const drawer = screen.getByRole('region', { name: 'Exile and the command zone' });
    expect(within(drawer).getByText(/Exile \(0\)/)).toBeTruthy();
    expect(within(drawer).getByText(/Command \(0\)/)).toBeTruthy();
    expect(within(drawer).queryByText(/Library/)).toBeNull();
    expect(within(drawer).queryByText(/Graveyard/)).toBeNull();
  });

  it('hands the zone up instead of carrying its own list of actions', () => {
    const { onMenu } = renderPanel();
    openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Exile actions' }));
    expect(onMenu).toHaveBeenCalledWith('exile');

    // The three rows it used to own are gone from here — the board's menu
    // has them, along with the seven it never had.
    for (const gone of ['Browse', 'Shuffle', 'Top cards']) {
      expect(screen.queryByRole('menuitem', { name: gone }), gone).toBeNull();
    }
  });

  it('gives both zones a menu', () => {
    const { onMenu } = renderPanel();
    for (const zone of ['Exile', 'Command'] as const) {
      // Reopened each time: the kebab closes the drawer behind it.
      openDrawer();
      fireEvent.click(screen.getByRole('button', { name: `${zone} actions` }));
      expect(onMenu, zone).toHaveBeenCalledWith(zone.toLowerCase());
    }
  });

  it('closes the drawer behind the menu — a sheet over a drawer is two deep', () => {
    renderPanel();
    openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Exile actions' }));
    expect(screen.queryByRole('region', { name: 'Exile and the command zone' })).toBeNull();
  });

  it('still browses a zone from the tile itself, and closes behind that too', () => {
    const { onOpenZone } = renderPanel();
    openDrawer();
    // The tile body, not the kebab: browsing is what these two piles are
    // for, and neither has a one-obvious-action click the way the library
    // (draw) does out on the felt.
    const tiles = document.querySelectorAll('.playtest-zone-tile__body');
    fireEvent.click(tiles[0]);
    expect(onOpenZone).toHaveBeenCalledWith('exile');
    expect(screen.queryByRole('region', { name: 'Exile and the command zone' })).toBeNull();
  });

  it('marks the kebab as opening a menu', () => {
    renderPanel();
    openDrawer();
    expect(
      screen.getByRole('button', { name: 'Exile actions' }).getAttribute('aria-haspopup')
    ).toBe('menu');
  });
});
