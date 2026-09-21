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
  fireEvent.click(screen.getByRole('button', { name: 'Show other zones' }));
}

describe('MobileZonesPanel', () => {
  it('lists every zone with its count once opened', () => {
    renderPanel();
    expect(screen.queryByRole('region', { name: 'Other zones' })).toBeNull();
    openDrawer();

    const drawer = screen.getByRole('region', { name: 'Other zones' });
    expect(within(drawer).getByText(/Library \(2\)/)).toBeTruthy();
    expect(within(drawer).getByText(/Graveyard \(1\)/)).toBeTruthy();
    expect(within(drawer).getByText(/Exile \(0\)/)).toBeTruthy();
    expect(within(drawer).getByText(/Command \(0\)/)).toBeTruthy();
  });

  it('hands the zone up instead of carrying its own list of actions', () => {
    const { onMenu } = renderPanel();
    openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Library actions' }));
    expect(onMenu).toHaveBeenCalledWith('library');

    // The three rows it used to own are gone from here — the board's menu
    // has them, along with the seven it never had.
    for (const gone of ['Browse', 'Shuffle', 'Top cards']) {
      expect(screen.queryByRole('menuitem', { name: gone }), gone).toBeNull();
    }
  });

  it('gives every zone a menu, not just the library', () => {
    const { onMenu } = renderPanel();
    for (const zone of ['Graveyard', 'Exile', 'Command'] as const) {
      // Reopened each time: the kebab closes the drawer behind it.
      openDrawer();
      fireEvent.click(screen.getByRole('button', { name: `${zone} actions` }));
      expect(onMenu, zone).toHaveBeenCalledWith(zone.toLowerCase());
    }
  });

  it('closes the drawer behind the menu — a sheet over a drawer is two deep', () => {
    renderPanel();
    openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Library actions' }));
    expect(screen.queryByRole('region', { name: 'Other zones' })).toBeNull();
  });

  it('still browses a zone from the tile itself, and closes behind that too', () => {
    const { onOpenZone } = renderPanel();
    openDrawer();
    // The tile body, not the kebab: the narrow tier keeps tap-to-browse
    // rather than mirroring the table tier's tap-to-draw, because the
    // action bar already owns Draw on a phone.
    const tiles = document.querySelectorAll('.playtest-zone-tile__body');
    fireEvent.click(tiles[0]);
    expect(onOpenZone).toHaveBeenCalledWith('library');
    expect(screen.queryByRole('region', { name: 'Other zones' })).toBeNull();
  });

  it('marks the kebab as opening a menu', () => {
    renderPanel();
    openDrawer();
    expect(
      screen.getByRole('button', { name: 'Library actions' }).getAttribute('aria-haspopup')
    ).toBe('menu');
  });
});
