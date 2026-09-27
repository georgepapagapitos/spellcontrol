// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders a bare tagline with the shared markup, no mark/hint/actions/role', () => {
    const { container } = render(<EmptyState tagline="No decks yet." />);
    const root = container.querySelector('.empty-state');
    expect(root).toBeTruthy();
    expect(root?.getAttribute('role')).toBeNull();
    expect(screen.getByText('No decks yet.').tagName).toBe('P');
    expect(container.querySelector('.empty-state-mark')).toBeNull();
    expect(container.querySelector('.empty-state-hint')).toBeNull();
    expect(container.querySelector('.empty-state-actions')).toBeNull();
  });

  it('renders the hint, the mark, and wraps actions', () => {
    const { container } = render(
      <EmptyState
        tagline="No decks yet."
        hint="Build a deck from scratch, or generate one from your collection."
        mark
        actions={<button type="button">New deck</button>}
      />
    );
    expect(screen.getByText(/Build a deck from scratch/)).toBeTruthy();
    expect(container.querySelector('.empty-state-mark')).toBeTruthy();
    const actionsWrap = container.querySelector('.empty-state-actions');
    expect(actionsWrap).toBeTruthy();
    expect(actionsWrap?.querySelector('button')).toBeTruthy();
  });

  it('renders the tagline as an h1 when taglineAs is set (the 404 page)', () => {
    render(<EmptyState tagline="Page not found." taglineAs="h1" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found.' })).toBeTruthy();
  });

  it('adds role="status" only when asked, for a state that replaces a loading skeleton', () => {
    const { container } = render(<EmptyState tagline="No friends yet." status />);
    expect(container.querySelector('.empty-state')?.getAttribute('role')).toBe('status');
  });

  it('merges actionsClassName onto the actions wrapper only', () => {
    const { container } = render(
      <EmptyState
        tagline="No decks yet."
        actions={<button type="button">Build a deck</button>}
        actionsClassName="decks-empty-actions"
      />
    );
    const wrap = container.querySelector('.empty-state-actions');
    expect(wrap?.classList.contains('decks-empty-actions')).toBe(true);
    expect(container.querySelector('.empty-state')?.classList.contains('decks-empty-actions')).toBe(
      false
    );
  });

  it('merges an extra className onto the container', () => {
    const { container } = render(<EmptyState tagline="Nothing here." className="my-extra" />);
    const root = container.querySelector('.empty-state');
    expect(root?.classList.contains('my-extra')).toBe(true);
  });

  it('renders the compact single-line variant with the caller-owned class, no wrapper markup', () => {
    const { container } = render(
      <EmptyState compact className="deck-section-empty">
        No sideboard cards yet
      </EmptyState>
    );
    expect(container.querySelector('.empty-state')).toBeNull();
    const line = container.querySelector('.deck-section-empty');
    expect(line?.tagName).toBe('P');
    expect(line?.textContent).toBe('No sideboard cards yet');
  });

  // An empty deck section's line stands in for its card list, so the section's
  // collapse chevron controls it and collapsing hides it.
  it('gives the compact line an id and hides it with the list it replaces', () => {
    const { container } = render(
      <EmptyState compact className="deck-section-empty" id="sb-list" hidden>
        No sideboard cards yet
      </EmptyState>
    );
    const line = container.querySelector('#sb-list');
    expect(line?.classList.contains('deck-section-empty')).toBe(true);
    expect(line?.hasAttribute('hidden')).toBe(true);
  });

  it('renders the compact variant as a div with a nested CTA and role="status"', () => {
    const { container } = render(
      <EmptyState compact as="div" className="pod-hub-stats-empty pod-hub-stats-empty-cta" status>
        <p>No games yet.</p>
        <button type="button">Plan a game night</button>
      </EmptyState>
    );
    const line = container.querySelector('.pod-hub-stats-empty');
    expect(line?.tagName).toBe('DIV');
    expect(line?.getAttribute('role')).toBe('status');
    expect(line?.querySelector('button')).toBeTruthy();
  });
});
