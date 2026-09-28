// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BinderLadder } from './BinderLadder';
import { UNCATEGORIZED_LADDER_ID, type LadderEntry } from '../lib/binder-counts';

function stubViewport(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /max-width:\s*599px/.test(query) ? phone : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

const ladder: LadderEntry[] = [
  { id: 'sld', name: 'Secret Lair', color: '#7a5bd6', count: 220, isDraft: false },
  { id: 'commanders', name: 'Commanders', color: '#3f8c58', count: 591, isDraft: false },
  { id: 'draft', name: 'Rares worth $1+', color: '#d65a9a', count: 1105, isDraft: true },
  { id: 'mana-rocks', name: 'Mana rocks', color: '#c3553e', count: 209, isDraft: false },
  { id: UNCATEGORIZED_LADDER_ID, name: 'Uncategorized', color: null, count: 11432, isDraft: false },
];

describe('BinderLadder', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists every binder in waterfall order, numbering everything but Uncategorized', () => {
    stubViewport(false);
    render(
      <BinderLadder
        ladder={ladder}
        draftId="draft"
        caughtAbove={0}
        caughtByLabel=""
        onMoveAbove={null}
        moveAboveLabel=""
      />
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    expect(rows[0].textContent).toContain('Secret Lair');
    expect(rows[0].textContent).toContain('220');
    expect(rows[4].textContent).toContain('Uncategorized');
    // Uncategorized carries no ordinal; the draft is #3.
    expect(rows[2].textContent).toContain('3');
  });

  it('highlights the draft as "This binder" regardless of its typed name', () => {
    stubViewport(false);
    render(
      <BinderLadder
        ladder={ladder}
        draftId="draft"
        caughtAbove={0}
        caughtByLabel=""
        onMoveAbove={null}
        moveAboveLabel=""
      />
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows[2].textContent).toContain('This binder');
    expect(rows[2].textContent).not.toContain('Rares worth $1+');
    expect(rows[2].className).toMatch(/is-me/);
  });

  it('shows the caught-by line with a working Move-above action', () => {
    stubViewport(false);
    const onMoveAbove = vi.fn();
    render(
      <BinderLadder
        ladder={ladder}
        draftId="draft"
        caughtAbove={107}
        caughtByLabel="Commanders"
        onMoveAbove={onMoveAbove}
        moveAboveLabel="Move above Commanders"
      />
    );
    expect(screen.getByText(/107 of its matches went to Commanders, above/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move above Commanders' }));
    expect(onMoveAbove).toHaveBeenCalledTimes(1);
  });

  it('is a quiet note by default, and the loud amber warning only when isEmpty is set', () => {
    stubViewport(false);
    const { rerender } = render(
      <BinderLadder
        ladder={ladder}
        draftId="draft"
        caughtAbove={107}
        caughtByLabel="Commanders"
        onMoveAbove={() => {}}
        moveAboveLabel="Move above Commanders"
      />
    );
    const quietLine = screen
      .getByText(/107 of its matches went to Commanders, above/)
      .closest('p')!;
    expect(quietLine.className).not.toMatch(/is-warning/);

    rerender(
      <BinderLadder
        ladder={ladder}
        draftId="draft"
        caughtAbove={107}
        caughtByLabel="Commanders"
        onMoveAbove={() => {}}
        moveAboveLabel="Move above Commanders"
        isEmpty
      />
    );
    const warningLine = screen
      .getByText(/107 of its matches went to Commanders, above/)
      .closest('p')!;
    expect(warningLine.className).toMatch(/is-warning/);
    // Still exactly one "Move above" control — this line carries the fix,
    // not a second box repeating it.
    expect(screen.getAllByRole('button', { name: 'Move above Commanders' })).toHaveLength(1);
  });

  it('omits the caught-by line when nothing was caught', () => {
    stubViewport(false);
    render(
      <BinderLadder
        ladder={ladder}
        draftId="draft"
        caughtAbove={0}
        caughtByLabel=""
        onMoveAbove={null}
        moveAboveLabel=""
      />
    );
    expect(screen.queryByText(/went to/)).toBeNull();
  });

  it('on a phone, shows only the neighbours until Show all is pressed', () => {
    stubViewport(true);
    render(
      <BinderLadder
        ladder={ladder}
        draftId="draft"
        caughtAbove={107}
        caughtByLabel="Commanders"
        onMoveAbove={() => {}}
        moveAboveLabel="Move above Commanders"
      />
    );
    // Neighbours: Commanders (above), the draft, Mana rocks (below).
    let rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(screen.queryByText('Secret Lair')).toBeNull();
    expect(screen.queryByText('Uncategorized')).toBeNull();
    // The caught-by line still names the real catcher even off-screen.
    expect(screen.getByText(/went to Commanders, above/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /show all/i }));
    rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    expect(screen.getByText('Secret Lair')).toBeTruthy();
    expect(screen.getByText('Uncategorized')).toBeTruthy();
  });

  it('desktop shows every binder without a Show-all control', () => {
    stubViewport(false);
    render(
      <BinderLadder
        ladder={ladder}
        draftId="draft"
        caughtAbove={0}
        caughtByLabel=""
        onMoveAbove={null}
        moveAboveLabel=""
      />
    );
    expect(screen.queryByRole('button', { name: /show all/i })).toBeNull();
  });
});
