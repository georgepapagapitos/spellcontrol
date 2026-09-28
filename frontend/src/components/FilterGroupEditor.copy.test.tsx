// @vitest-environment happy-dom
/**
 * E497 copy pass: the "add rule" button reads "+ Also take other cards"
 * (never the retired "+ Or match other cards too"), sits under an "or"
 * divider that now follows EVERY rule including the last one, and an
 * unnamed rule's title is its autoSummary sentence once it has conditions —
 * "Match all of" is reserved for a genuinely empty, unnamed rule.
 */
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FilterGroupList } from './FilterGroupEditor';
import type { BinderFilterGroup } from '../types';

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

describe('FilterGroupEditor copy (E497)', () => {
  it('the add-rule button reads "+ Also take other cards"', () => {
    render(<Harness initial={[{ filter: {} }]} />);
    expect(screen.getByRole('button', { name: '+ Also take other cards' })).toBeTruthy();
    expect(screen.queryByText('+ Or match other cards too')).toBeNull();
  });

  it('an "or" divider follows every rule, including the last, right before the button', () => {
    render(
      <Harness
        initial={[{ filter: { nameContains: 'sword' } }, { filter: { nameContains: 'dragon' } }]}
      />
    );
    const dividers = document.querySelectorAll('.filter-group-or');
    // One divider after each of the two rules — the second sits between the
    // last rule and the "Also take other cards" button.
    expect(dividers.length).toBe(2);
    dividers.forEach((d) => expect(d.textContent).toBe('or'));
  });

  it('an empty unnamed rule still reads "Match all of"', () => {
    render(<Harness initial={[{ filter: {} }]} />);
    expect(document.querySelector('.filter-group-title')?.textContent).toBe('Match all of');
  });

  it('an unnamed rule with conditions shows its autoSummary sentence as the title', () => {
    render(
      <Harness
        initial={[
          {
            filter: {
              rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] },
              priceMin: 1,
            },
          },
        ]}
      />
    );
    const title = document.querySelector('.filter-group-title')?.textContent ?? '';
    expect(title).not.toBe('Match all of');
    expect(title.length).toBeGreaterThan(0);
    // Same string the editor already used as the rename placeholder/aria-label.
    expect(screen.getByRole('button', { name: `Actions for rule: ${title}` })).toBeTruthy();
  });
});
