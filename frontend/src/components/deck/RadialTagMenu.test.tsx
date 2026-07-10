// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RadialTagMenu } from './RadialTagMenu';
import { DECK_CARD_TAGS } from '@/lib/deck-card-tags';

function renderMenu(over: Partial<Parameters<typeof RadialTagMenu>[0]> = {}) {
  const onToggle = vi.fn();
  const onClose = vi.fn();
  render(
    <RadialTagMenu
      anchor={{ x: 300, y: 300 }}
      activeTags={[]}
      onToggle={onToggle}
      onClose={onClose}
      {...over}
    />
  );
  return { onToggle, onClose };
}

describe('RadialTagMenu', () => {
  it('renders all 8 palette tags as menuitemcheckbox items in a menu', () => {
    renderMenu();
    expect(screen.getByRole('menu', { name: 'Card tags' })).toBeTruthy();
    const items = screen.getAllByRole('menuitemcheckbox');
    expect(items).toHaveLength(8);
    expect(items.map((el) => el.textContent)).toEqual([...DECK_CARD_TAGS]);
  });

  it('reflects activeTags via aria-checked (and the filled-chip class)', () => {
    renderMenu({ activeTags: ['Draw', 'Payoff'] });
    for (const item of screen.getAllByRole('menuitemcheckbox')) {
      const shouldBeChecked = item.textContent === 'Draw' || item.textContent === 'Payoff';
      expect(item.getAttribute('aria-checked')).toBe(String(shouldBeChecked));
      expect(item.classList.contains('is-active')).toBe(shouldBeChecked);
    }
  });

  it('click toggles a tag WITHOUT closing (click mode applies several)', () => {
    const { onToggle, onClose } = renderMenu();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Ramp' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Wincon' }));
    expect(onToggle.mock.calls).toEqual([['Ramp'], ['Wincon']]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape closes without toggling', () => {
    const { onToggle, onClose } = renderMenu();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('focuses the first item on open and roves clockwise with ArrowRight', () => {
    renderMenu();
    const items = screen.getAllByRole('menuitemcheckbox');
    expect(document.activeElement).toBe(items[0]);
    expect(items[0].tabIndex).toBe(0);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(items[1]);
    expect(items[1].tabIndex).toBe(0);
    expect(items[0].tabIndex).toBe(-1);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[2]);
  });

  it('roves counterclockwise (wrapping) with ArrowLeft/ArrowUp', () => {
    renderMenu();
    const items = screen.getAllByRole('menuitemcheckbox');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(items[7]);
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[6]);
  });

  it('Enter toggles the highlighted tag and keeps the menu open', () => {
    const { onToggle, onClose } = renderMenu();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(DECK_CARD_TAGS[1]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Space toggles the highlighted tag too', () => {
    const { onToggle } = renderMenu();
    fireEvent.keyDown(window, { key: ' ' });
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(DECK_CARD_TAGS[0]);
  });

  it('a pointerdown outside the sector chips closes the menu', () => {
    const { onClose } = renderMenu();
    // First press marks the opening gesture over (keyboard-open path), the
    // outside hit closes.
    fireEvent.pointerDown(document.body, { clientX: 10, clientY: 10 });
    expect(onClose).toHaveBeenCalled();
  });

  it('a pointerdown on a sector chip does not close (click-mode toggle)', () => {
    const { onClose } = renderMenu();
    fireEvent.pointerDown(screen.getByRole('menuitemcheckbox', { name: 'Ramp' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('press → drag past the dead zone → release commits the sector and closes (swipe)', () => {
    const { onToggle, onClose } = renderMenu();
    // 80px straight up from the press: past the 24px dead zone, 12 o'clock.
    fireEvent.pointerMove(window, { clientX: 300, clientY: 220, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 300, clientY: 220 });
    expect(onToggle).toHaveBeenCalledExactlyOnceWith('Ramp');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a motionless tap parks the menu open even when the ring center is clamped away from the press', () => {
    // Press near the right viewport edge (where every row's tag button sits):
    // the ring center clamps ~100px left of the finger, so measured from the
    // CENTER this release sits deep in the 3 o'clock sector. It must read as
    // a tap (park open), not a swipe-commit.
    const { onToggle, onClose } = renderMenu({ anchor: { x: 1000, y: 300 } });
    fireEvent.pointerUp(window, { clientX: 1000, clientY: 300 });
    expect(onToggle).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('tap micro-jitter under the dead-zone radius does not arm a swipe-commit', () => {
    const { onToggle, onClose } = renderMenu({ anchor: { x: 1000, y: 300 } });
    fireEvent.pointerMove(window, { clientX: 1005, clientY: 302, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 1005, clientY: 302 });
    expect(onToggle).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('an armed swipe released back in the ring center parks open instead of committing', () => {
    const { onToggle, onClose } = renderMenu();
    fireEvent.pointerMove(window, { clientX: 300, clientY: 220, buttons: 1 });
    fireEvent.pointerMove(window, { clientX: 302, clientY: 295, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 302, clientY: 295 });
    expect(onToggle).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on scroll — the fixed-position ring is stale over a moved list', () => {
    const { onToggle, onClose } = renderMenu();
    fireEvent.scroll(window);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('closes on resize', () => {
    const { onClose } = renderMenu();
    fireEvent.resize(window);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the opening tap's echo click on the chip under the release point does not toggle", () => {
    // Edge-clamped anchor: the ring center sits ~100px left of the press, so
    // the 3 o'clock chip (Interaction) mounts at the release point. The tap's
    // release parks the menu open — then the browser synthesizes a click at
    // that same point, targeting the chip. It must be ignored (no fresh
    // pointerdown preceded it), not toggle a tag the user never chose.
    const { onToggle, onClose } = renderMenu({ anchor: { x: 1000, y: 300 } });
    fireEvent.pointerUp(window, { clientX: 1000, clientY: 300 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Interaction' }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a deliberate chip click (fresh press) after the opening tap still toggles', () => {
    const { onToggle, onClose } = renderMenu({ anchor: { x: 1000, y: 300 } });
    fireEvent.pointerUp(window, { clientX: 1000, clientY: 300 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Interaction' })); // echo
    const chip = screen.getByRole('menuitemcheckbox', { name: 'Draw' });
    fireEvent.pointerDown(chip);
    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalledExactlyOnceWith('Draw');
    expect(onClose).not.toHaveBeenCalled();
  });
});
