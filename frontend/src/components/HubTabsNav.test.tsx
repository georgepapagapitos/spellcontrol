// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HubTabsNav } from './HubTabsNav';

/**
 * happy-dom does no layout, so every getBoundingClientRect is 0×0 and the
 * scroll-into-view effect can't be observed without geometry. Fake a 360px
 * strip whose tabs are laid out left-to-right at a fixed width, so "is the
 * active tab past the right edge" becomes a real question.
 */
function stubStripGeometry(container: HTMLElement, { tabWidth = 120, navWidth = 360 } = {}) {
  const nav = container.querySelector('nav') as HTMLElement;
  const links = [...container.querySelectorAll('a')] as HTMLElement[];
  Object.defineProperty(nav, 'scrollLeft', { value: 0, writable: true });
  nav.getBoundingClientRect = () => ({ left: 0, right: navWidth, width: navWidth }) as DOMRect;
  links.forEach((el, i) => {
    // Positions shift by the strip's current scroll, exactly like a real scroller.
    el.getBoundingClientRect = () =>
      ({
        left: i * tabWidth - nav.scrollLeft,
        right: (i + 1) * tabWidth - nav.scrollLeft,
        width: tabWidth,
      }) as DOMRect;
  });
  return nav;
}

function renderNav(tabs: Parameters<typeof HubTabsNav>[0]['tabs']) {
  return render(
    <MemoryRouter>
      <HubTabsNav ariaLabel="Test sections" tabs={tabs} />
    </MemoryRouter>
  );
}

describe('HubTabsNav', () => {
  // The Collection and Decks hubs each hand-rolled this markup, so the
  // aria-current wiring was restated per tab and could drift between them.
  it('marks exactly one tab as the current page', () => {
    renderNav([
      { to: '/a', label: 'Alpha', active: false },
      { to: '/b', label: 'Beta', active: true },
      { to: '/c', label: 'Gamma', active: false },
    ]);
    expect(screen.getByRole('link', { name: 'Beta' }).getAttribute('aria-current')).toBe('page');
    for (const name of ['Alpha', 'Gamma']) {
      expect(screen.getByRole('link', { name }).getAttribute('aria-current')).toBeNull();
    }
  });

  it('gives the active tab the active class and the others the plain one', () => {
    renderNav([
      { to: '/a', label: 'Alpha', active: true },
      { to: '/b', label: 'Beta', active: false },
    ]);
    expect(screen.getByRole('link', { name: 'Alpha' }).className).toBe('site-nav-link active');
    expect(screen.getByRole('link', { name: 'Beta' }).className).toBe('site-nav-link');
  });

  it('abbreviates large counts and labels them for screen readers', () => {
    renderNav([
      { to: '/a', label: 'Cards', active: true, count: 12, countNoun: 'cards' },
      { to: '/b', label: 'Binders', active: false, count: 2400, countNoun: 'binders' },
      { to: '/c', label: 'Lists', active: false, count: 24_000, countNoun: 'lists' },
    ]);
    expect(screen.getByText('12')).toBeTruthy();
    // Under 10k keeps one decimal; at or above it rounds to whole thousands.
    expect(screen.getByText('2.4k')).toBeTruthy();
    expect(screen.getByText('24k')).toBeTruthy();
    // The raw count, not the abbreviation, is what a screen reader announces.
    expect(screen.getByLabelText('24000 lists')).toBeTruthy();
  });

  it('renders no count chip for zero or an absent count', () => {
    const { container } = renderNav([
      { to: '/a', label: 'Cards', active: true, count: 0, countNoun: 'cards' },
      { to: '/b', label: 'Sets', active: false },
    ]);
    expect(container.querySelectorAll('.site-nav-count')).toHaveLength(0);
  });

  it('renders only the tabs it is given, so a hub can omit one', () => {
    // DecksHubTabs drops Saved entirely for guests rather than rendering it
    // disabled — the strip must not reserve space for absent tabs.
    renderNav([
      { to: '/decks', label: 'My Decks', active: true },
      { to: '/decks/discover', label: 'Discover', active: false },
    ]);
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Saved' })).toBeNull();
  });

  describe('keeping the active tab in view', () => {
    // The strip is a horizontal scroller; on a 360px phone the Collection
    // hub's own active tab (Combos, 5th of 5) sat half-clipped past the right
    // edge, so you couldn't see which section you were in.
    const TABS = (activeIdx: number, counts: (number | undefined)[] = []) =>
      ['Cards', 'Binders', 'Lists', 'Sets', 'Combos'].map((label, i) => ({
        to: `/t${i}`,
        label,
        active: i === activeIdx,
        count: counts[i],
      }));

    it('scrolls a right-overflowing active tab into view', () => {
      const { container, rerender } = render(
        <MemoryRouter>
          <HubTabsNav ariaLabel="Sections" tabs={TABS(0)} />
        </MemoryRouter>
      );
      const nav = stubStripGeometry(container);
      // Tab 4 spans 480–600 in a 360-wide strip — well past the right edge.
      rerender(
        <MemoryRouter>
          <HubTabsNav ariaLabel="Sections" tabs={TABS(4)} />
        </MemoryRouter>
      );
      expect(nav.scrollLeft).toBeGreaterThan(0);
      const active = screen.getByRole('link', { name: 'Combos' });
      expect(active.getBoundingClientRect().right).toBeLessThanOrEqual(360);
    });

    it('leaves an already-visible active tab alone', () => {
      const { container, rerender } = render(
        <MemoryRouter>
          <HubTabsNav ariaLabel="Sections" tabs={TABS(4)} />
        </MemoryRouter>
      );
      const nav = stubStripGeometry(container);
      rerender(
        <MemoryRouter>
          <HubTabsNav ariaLabel="Sections" tabs={TABS(1)} />
        </MemoryRouter>
      );
      // Tab 1 spans 120–240: inside the strip, so no scrolling is warranted.
      expect(nav.scrollLeft).toBe(0);
    });

    it('re-runs when async counts widen the strip, not just on route change', () => {
      // The regression this guards: count chips ("12K") arrive AFTER first
      // paint. Keyed only on the active route, the effect had already run and
      // the widened strip pushed the active tab back out of view.
      const { container, rerender } = render(
        <MemoryRouter>
          <HubTabsNav ariaLabel="Sections" tabs={TABS(4)} />
        </MemoryRouter>
      );
      const nav = stubStripGeometry(container, { tabWidth: 60 });
      // At 60px/tab everything fits (300 < 360) — nothing to scroll.
      rerender(
        <MemoryRouter>
          <HubTabsNav ariaLabel="Sections" tabs={TABS(4)} />
        </MemoryRouter>
      );
      expect(nav.scrollLeft).toBe(0);

      // Counts land: same active route, but the tabs are now wider.
      stubStripGeometry(container, { tabWidth: 120 });
      rerender(
        <MemoryRouter>
          <HubTabsNav ariaLabel="Sections" tabs={TABS(4, [11531, 3, 2, 0, 1011])} />
        </MemoryRouter>
      );
      expect(nav.scrollLeft).toBeGreaterThan(0);
    });
  });
});
