// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { BarChart3, Flag, ScrollText } from 'lucide-react';
import { GameMenuSheet, type GameMenuSection } from './GameMenuSheet';

const sections = (log: () => void): GameMenuSection[] => [
  {
    title: 'Table',
    items: [
      { label: 'Stats', icon: BarChart3, onClick: vi.fn() },
      { label: 'Log', icon: ScrollText, note: 'New', onClick: log },
    ],
  },
  // Every row of this one is conditional at the call site; when they all drop
  // out the heading must go with them.
  { title: 'Settings', items: [] },
];

const footer = (concede: () => void): GameMenuSection => ({
  title: 'Game',
  items: [{ label: 'Concede', icon: Flag, danger: true, onClick: concede }],
});

function open(overrides: { log?: () => void; concede?: () => void; onClose?: () => void } = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  render(
    <GameMenuSheet
      sections={sections(overrides.log ?? vi.fn())}
      footer={footer(overrides.concede ?? vi.fn())}
      onClose={onClose}
    />
  );
  return { onClose, drawer: screen.getByRole('dialog', { name: 'Game menu' }) };
}

describe('GameMenuSheet', () => {
  it('groups the rows under their headings and drops an empty group', () => {
    const { drawer } = open();
    expect(within(drawer).getByRole('heading', { name: 'Table' })).toBeTruthy();
    expect(within(drawer).getByRole('heading', { name: 'Game' })).toBeTruthy();
    expect(within(drawer).queryByRole('heading', { name: 'Settings' })).toBeNull();
    expect(within(drawer).getByRole('button', { name: /Log/ }).textContent).toContain('New');
  });

  it('keeps the game-enders out of the scrolling body', () => {
    const { drawer } = open();
    const concede = within(drawer).getByRole('button', { name: 'Concede' });
    expect(concede.closest('.playtest-game-menu__end')).toBeTruthy();
    expect(concede.className).toContain('is-danger');
    expect(
      within(drawer).getByRole('button', { name: 'Stats' }).closest('.playtest-game-menu__body')
    ).toBeTruthy();
  });

  it('runs the row and starts closing, so a sheet it opens is not left under the drawer', () => {
    const log = vi.fn();
    const { drawer } = open({ log });
    fireEvent.click(within(drawer).getByRole('button', { name: /Log/ }));
    expect(log).toHaveBeenCalledOnce();
    expect(drawer.className).toContain('is-closing');
  });

  it('closes on Escape and on the scrim', () => {
    const onClose = vi.fn();
    const { drawer } = open({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(drawer.className).toContain('is-closing');
    // The exit animation is what unmounts it; the sheet has not called back yet.
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.animationEnd(drawer, { animationName: 'playtest-game-menu-out' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
