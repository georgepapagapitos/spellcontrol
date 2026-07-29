// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HubTabsNav } from './HubTabsNav';

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
});
