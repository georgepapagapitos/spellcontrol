// @vitest-environment happy-dom
/**
 * T157 — a rule's name is a LIVE field (STYLE_GUIDE § Verbs — Rename), not
 * InlineRename: onSetName writes straight into the binder editor's own
 * uncommitted draft on every keystroke, so there is no separate committed
 * value for blur to fall back to. The one piece missing before this fix was
 * Escape-reverts: Escape closed the field but left whatever had been typed
 * sitting in the draft.
 */
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FilterGroupList } from './FilterGroupEditor';
import type { BinderFilterGroup } from '@/types/index';

function Harness({ initial }: { initial: BinderFilterGroup[] }) {
  const [groups, setGroups] = useState(initial);
  return (
    <FilterGroupList
      groups={groups}
      cards={[]}
      ownedSets={[]}
      typeSuggestions={[]}
      oracleSuggestions={[]}
      autofocusIdx={null}
      clearAutofocus={() => {}}
      onPatchFilter={(idx, p) =>
        setGroups((gs) =>
          gs.map((g, i) => (i === idx ? { ...g, filter: { ...g.filter, ...p } } : g))
        )
      }
      onSetName={(idx, name) =>
        setGroups((gs) => gs.map((g, i) => (i === idx ? { ...g, name } : g)))
      }
      onAdd={() => {}}
      onDuplicate={() => {}}
      onRemove={() => {}}
    />
  );
}

describe('FilterGroupEditor rule name — Escape reverts the live draft', () => {
  const titleText = () => document.querySelector('.filter-group-title')?.textContent;

  it('Escape restores the name the field opened with, discarding what was typed', () => {
    render(
      <Harness initial={[{ filter: { typeChips: { chips: [], joiners: [] } }, name: 'Lands' }]} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Actions for rule: Lands' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));

    const input = screen.getByLabelText('Name for rule 1');
    fireEvent.change(input, { target: { value: 'Discarded' } });
    // The live field already reflects the keystroke.
    expect(screen.getByLabelText('Name for rule 1')).toHaveProperty('value', 'Discarded');

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByLabelText('Name for rule 1')).toBeNull();
    expect(titleText()).toBe('Lands');
  });

  it('Enter keeps the live-typed value (the draft, not a separate commit)', () => {
    render(
      <Harness initial={[{ filter: { typeChips: { chips: [], joiners: [] } }, name: 'Lands' }]} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Actions for rule: Lands' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));

    const input = screen.getByLabelText('Name for rule 1');
    fireEvent.change(input, { target: { value: 'Removal' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.queryByLabelText('Name for rule 1')).toBeNull();
    expect(titleText()).toBe('Removal');
  });
});
