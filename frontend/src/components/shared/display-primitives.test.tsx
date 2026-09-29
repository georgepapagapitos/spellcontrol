// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Layers } from 'lucide-react';
import { ArtBadge } from './ArtBadge';
import { Chip } from './Chip';
import { Count } from './Count';
import { SectionHeader } from './SectionHeader';
import { Surface } from './Surface';

describe('Chip tone', () => {
  it('renders as data-tone on every role, and not at all when unset', () => {
    const { container } = render(
      <>
        <Chip className="deck-format-badge" tone="warn">
          Brawl
        </Chip>
        <Chip className="coach-feed-filter-chip" tone="success" pressed onClick={() => {}}>
          Adds
        </Chip>
        <Chip className="x-chip" tone="err" onRemove={() => {}} removeLabel="Remove">
          Red
        </Chip>
        <Chip className="plain-chip">Plain</Chip>
      </>
    );
    const [label, filter, removable, plain] = [...container.children];
    expect(label.getAttribute('data-tone')).toBe('warn');
    expect(filter.getAttribute('data-tone')).toBe('success');
    expect(removable.getAttribute('data-tone')).toBe('err');
    expect(plain.hasAttribute('data-tone')).toBe(false);
  });
});

describe('ArtBadge', () => {
  it('is a span carrying the family class, its corner and tone', () => {
    const { container } = render(
      <ArtBadge className="deck-combos-card-qty-badge" corner="top-end" tone="accent">
        ×2
      </ArtBadge>
    );
    const badge = container.firstElementChild!;
    expect(badge.tagName).toBe('SPAN');
    expect(badge.className).toBe('art-badge deck-combos-card-qty-badge');
    expect(badge.getAttribute('data-corner')).toBe('top-end');
    expect(badge.getAttribute('data-tone')).toBe('accent');
    expect(badge.textContent).toBe('×2');
    expect(badge.hasAttribute('data-icon-only')).toBe(false);
    // Text that says what it means needs no second name.
    expect(badge.hasAttribute('role')).toBe(false);
  });

  it('names an icon-only badge and hides the glyph', () => {
    render(
      <ArtBadge
        className="card-list-deck-badge"
        corner="bottom-start"
        label="In 2 decks"
        icon={<Layers data-testid="glyph" />}
      />
    );
    const badge = screen.getByRole('img', { name: 'In 2 decks' });
    expect(badge.hasAttribute('data-icon-only')).toBe(true);
    expect(badge.querySelector('[data-testid="glyph"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('takes no corner inside a cluster, which pins for it', () => {
    const { container } = render(<ArtBadge className="collection-grid-qty">3</ArtBadge>);
    expect(container.firstElementChild!.hasAttribute('data-corner')).toBe(false);
  });

  it('can give text a name that says what it means', () => {
    render(
      <ArtBadge className="slot-qty-badge" corner="top-end" label="2 copies">
        ×2
      </ArtBadge>
    );
    expect(screen.getByRole('img', { name: '2 copies' }).textContent).toBe('×2');
  });
});

describe('Count', () => {
  it('renders nothing at zero or below', () => {
    const { container } = render(
      <>
        <Count className="collection-filters-badge" value={0} placement="corner" />
        <Count className="collection-filters-badge" value={-1} placement="corner" />
      </>
    );
    expect(container.innerHTML).toBe('');
  });

  it('is hidden from assistive tech: the control it sits in says the number', () => {
    const { container } = render(
      <Count className="collection-filters-badge" value={3} placement="corner" tone="accent" />
    );
    const count = container.firstElementChild!;
    expect(count.textContent).toBe('3');
    expect(count.className).toBe('count-badge collection-filters-badge');
    expect(count.getAttribute('aria-hidden')).toBe('true');
    expect(count.getAttribute('data-placement')).toBe('corner');
    expect(count.getAttribute('data-tone')).toBe('accent');
  });

  it('with a label stands alone as a named image', () => {
    render(
      <Count className="mobile-tab-bar-badge" value={4} placement="inline" label="4 unread" />
    );
    const count = screen.getByRole('img', { name: '4 unread' });
    expect(count.hasAttribute('aria-hidden')).toBe(false);
  });

  it('shows a capped display in place of the number', () => {
    const { container } = render(
      <Count className="friends-nav-link-badge" value={120} display="99+" placement="inline" />
    );
    expect(container.textContent).toBe('99+');
  });
});

describe('Surface', () => {
  it('defaults to a div and carries its variant', () => {
    const { container } = render(
      <Surface variant="framed" className="deck-combos-panel">
        body
      </Surface>
    );
    const el = container.firstElementChild!;
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('deck-combos-panel');
    expect(el.getAttribute('data-surface')).toBe('framed');
    expect(el.textContent).toBe('body');
  });

  it('takes the element for its role and passes attributes through', () => {
    const { container } = render(
      <ul>
        <Surface variant="sleeve" as="li" className="decks-index-card" aria-label="Krenko">
          tile
        </Surface>
      </ul>
    );
    const el = container.querySelector('li.decks-index-card')!;
    expect(el.getAttribute('data-surface')).toBe('sleeve');
    expect(el.getAttribute('aria-label')).toBe('Krenko');
  });
});

describe('SectionHeader', () => {
  it('with nothing beside the title is only the heading', () => {
    const { container } = render(
      <SectionHeader id="pods" title="Pods" className="pod-hub-section-head" />
    );
    const h = container.firstElementChild!;
    expect(h.tagName).toBe('H2');
    expect(h.id).toBe('pods');
    expect(h.className).toBe('pod-hub-section-head');
  });

  it('with tools is a row: title, meta, then the tools group', () => {
    const { container } = render(
      <SectionHeader
        id="home-your-decks"
        title="Your decks"
        level={3}
        className="home-section-head"
        titleClassName="home-section-title"
        meta={<span className="home-section-meta">12</span>}
        tools={<a href="/decks">All 12</a>}
        toolsClassName="home-section-tools"
      />
    );
    const row = container.firstElementChild!;
    expect(row.className).toBe('home-section-head');
    expect([...row.children].map((c) => c.className || c.tagName)).toEqual([
      'home-section-title',
      'home-section-meta',
      'home-section-tools',
    ]);
    expect(screen.getByRole('heading', { level: 3, name: 'Your decks' }).id).toBe(
      'home-your-decks'
    );
  });
  it('as a header: leading, the heading wrapped with what follows it, then bare tools', () => {
    const { container } = render(
      <SectionHeader
        as="header"
        className="deck-section-header"
        level={3}
        variant="overline"
        titleClassName="deck-section-title"
        titleTabIndex={-1}
        title="Creatures"
        leading={<span className="deck-section-icon" />}
        titleWrapClassName="deck-section-title-row"
        titleAfter={<div className="deck-section-gauge" />}
        tools={<span className="deck-section-subtotal">$4</span>}
      />
    );
    const row = container.firstElementChild!;
    expect(row.tagName).toBe('HEADER');
    expect([...row.children].map((c) => c.className)).toEqual([
      'deck-section-icon',
      'deck-section-title-row',
      'deck-section-subtotal',
    ]);
    expect([...row.children[1].children].map((c) => c.className)).toEqual([
      'deck-section-title',
      'deck-section-gauge',
    ]);
    const h = screen.getByRole('heading', { level: 3, name: 'Creatures' });
    expect(h.getAttribute('tabindex')).toBe('-1');
    expect(h.getAttribute('data-heading')).toBe('overline');
  });

  it('as a header stays the row when nothing sits beside the title', () => {
    const { container } = render(
      <SectionHeader
        as="header"
        id="past-head"
        className="trades-section-head"
        titleClassName="trades-section-title"
        title="Past"
        tools={false}
      />
    );
    const row = container.firstElementChild!;
    expect(row.tagName).toBe('HEADER');
    expect(row.className).toBe('trades-section-head');
    expect([...row.children].map((c) => c.className)).toEqual(['trades-section-title']);
    expect(row.firstElementChild!.id).toBe('past-head');
  });
});
