// @vitest-environment happy-dom
/**
 * UX-212 a11y regression gate: axe-core smoke tests over the shared
 * primitives (Modal, Tabs, OverflowMenu) and the CardListTable row markup.
 * Each test renders a representative state and asserts zero axe violations,
 * so an ARIA regression (invalid role/attr combos, missing accessible
 * names, broken parent/child role contracts) fails CI instead of shipping.
 *
 * Uses `vitest-axe` (a jest-axe port; runtime-compatible with vitest 4 —
 * matchers are plain `expect.extend` material). Its shipped type
 * augmentation targets the pre-1.0 `namespace Vi` global, which vitest 4
 * no longer reads, so the module augmentation below registers
 * `toHaveNoViolations` with the current `Matchers` interface instead.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import * as matchers from 'vitest-axe/matchers';
import type { AxeMatchers } from 'vitest-axe/matchers';
import type { EnrichedCard } from '../types';
import { Modal } from './Modal';
import { OverflowMenu } from './OverflowMenu';
import { Tabs } from './Tabs';

expect.extend(matchers);

declare module 'vitest' {
  // Type parameter must match vitest's own `Matchers<T = any>` declaration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type
  interface Matchers<T = any> extends AxeMatchers {}
}

// Render every virtual row so the list markup exists in happy-dom (no
// layout → the real virtualizer would render nothing). Same shim as
// CardListTable.grouped-preview.test.tsx.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: index,
        index,
        start: index * 40,
        size: 40,
      })),
    getTotalSize: () => count * 40,
    measureElement: () => {},
    scrollToIndex: () => {},
    scrollToOffset: () => {},
  }),
}));

import { CardListTable } from './CardListTable';

/**
 * Component-scoped axe run:
 * - `color-contrast` is meaningless without a layout engine (happy-dom
 *   computes no real styles) and is owned by visual review, not this gate.
 * - `region` ("content must be in landmarks") is a page-level rule; these
 *   tests render isolated fragments without the app shell's landmarks.
 */
const runAxe = configureAxe({
  rules: {
    'color-contrast': { enabled: false },
    region: { enabled: false },
  },
});

describe('a11y smoke (axe): shared primitives', () => {
  it('Modal — open dialog with focusable children has no violations', async () => {
    const { baseElement } = render(
      <Modal onClose={() => {}} labelledBy="a11y-modal-title">
        <h2 id="a11y-modal-title">Example dialog</h2>
        <label>
          Name <input type="text" />
        </label>
        <button type="button">Cancel</button>
        <button type="button">Save</button>
      </Modal>
    );
    expect(await runAxe(baseElement)).toHaveNoViolations();
  });

  it('Tabs — tablist with a selected tab and its panel has no violations', async () => {
    const tabs = [
      { id: 'cards', label: 'Cards', controls: 'a11y-panel-cards' },
      { id: 'binders', label: 'Binders', count: 3, controls: 'a11y-panel-binders' },
      { id: 'lists', label: 'Lists', controls: 'a11y-panel-lists' },
    ] as const;
    const { container } = render(
      <>
        <Tabs
          tabs={[...tabs]}
          value="binders"
          onChange={() => {}}
          ariaLabel="Collection sections"
        />
        {tabs.map((t) => (
          <div
            key={t.id}
            id={t.controls}
            role="tabpanel"
            aria-labelledby={`sc-tab-${t.id}`}
            hidden={t.id !== 'binders'}
          >
            {t.id} panel
          </div>
        ))}
      </>
    );
    expect(await runAxe(container)).toHaveNoViolations();
  });

  it('OverflowMenu — open menu with items has no violations', async () => {
    const { container } = render(
      <OverflowMenu
        ariaLabel="Deck actions"
        items={[
          { label: 'Rename', onClick: () => {} },
          { label: 'Duplicate', onClick: () => {} },
          { label: 'Delete', onClick: () => {}, danger: true },
        ]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Deck actions' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(await runAxe(container)).toHaveNoViolations();
  });
});

// ---------------------------------------------------------------------------
// CardListTable row markup (the UX-212 Part 2 fix: list rows are
// role="button" toggles like the grid tiles — not orphaned role="row").
// ---------------------------------------------------------------------------

let idSeq = 0;
function mk(o: Partial<EnrichedCard>): EnrichedCard {
  idSeq += 1;
  return {
    copyId: `copy-${idSeq}`,
    name: 'Card',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: `sf-${idSeq}`,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Instant',
    cmc: 1,
    ...o,
  } as EnrichedCard;
}

/**
 * Known, pre-existing structural issue (NOT a UX-212 regression): the row
 * is a clickable widget that wraps the CardRowMenu kebab `<button>`, so axe
 * flags `nested-interactive` ("Element has focusable descendants"). The row
 * has always nested the kebab; fixing it properly means restructuring the
 * row (primary action as a sibling/overlay button instead of a container
 * widget), which is a layout refactor owned by a follow-up — out of scope
 * here. The assertion below pins the violation set to EXACTLY this one id,
 * so any new violation still fails the gate, and a future structural fix
 * shows up as this assertion failing (then delete the allowance).
 */
async function expectOnlyKnownRowViolations(row: Element) {
  const results = await runAxe(row);
  expect(results.violations.map((v) => v.id)).toEqual(['nested-interactive']);
}

describe('a11y smoke (axe): CardListTable list rows', () => {
  beforeEach(() => {
    idSeq = 0;
    localStorage.setItem('mtg-collection-view-mode', 'list');
  });

  it('list rows are valid button toggles (no violations beyond the known nested kebab)', async () => {
    const cards = [
      mk({ name: 'Lightning Bolt', scryfallId: 'sf-bolt' }),
      mk({ name: 'Counterspell', scryfallId: 'sf-counter' }),
    ];
    const { container } = render(
      <MemoryRouter>
        <CardListTable cards={cards} binders={[]} />
      </MemoryRouter>
    );

    const rows = Array.from(container.querySelectorAll('.collection-list-row'));
    expect(rows).toHaveLength(2);
    // The Part 2 contract: button role (valid outside any table/grid), not
    // an orphaned row role.
    for (const row of rows) expect(row.getAttribute('role')).toBe('button');

    for (const row of rows) {
      await expectOnlyKnownRowViolations(row);
    }
  });

  it('selectable list rows expose aria-pressed (no violations beyond the known nested kebab)', async () => {
    const cards = [mk({ name: 'Lightning Bolt', scryfallId: 'sf-bolt' })];
    const { container } = render(
      <MemoryRouter>
        <CardListTable cards={cards} binders={[]} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    const row = container.querySelector('.collection-list-row') as HTMLElement;
    expect(row.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(row);
    expect(row.getAttribute('aria-pressed')).toBe('true');

    await expectOnlyKnownRowViolations(row);
  });
});
