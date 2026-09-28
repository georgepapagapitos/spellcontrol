// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BinderPage, BinderSection, EnrichedCard, MaterializedBinder } from '../types';
import { BinderEditorPreviewStrip } from './BinderEditorPreviewStrip';

vi.mock('./PageGrid', () => ({
  PageGrid: () => <div data-testid="strip-thumb" />,
}));

let lastPagesProps: Record<string, unknown> | null = null;
vi.mock('./BinderPagePreview', () => ({
  BinderPagePreview: (props: Record<string, unknown>) => {
    lastPagesProps = props;
    return <div data-testid="page-viewer">{(props.binderName as string) ?? ''}</div>;
  },
}));

function card(i: number): EnrichedCard {
  return {
    copyId: `c${i}`,
    name: `Card ${i}`,
    setCode: 'TST',
    setName: 'Test',
    collectorNumber: `${i}`,
    rarity: 'common',
    scryfallId: `s${i}`,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
  } as EnrichedCard;
}

function fakeBinder(): MaterializedBinder {
  const whiteCards = Array.from({ length: 9 }, (_, i) => card(i));
  const pages: BinderPage[] = [{ pageNum: 1, slots: whiteCards }];
  const white: BinderSection = { key: 'W', label: 'White', cards: whiteCards, pages };
  return {
    def: {
      id: 'b',
      name: 'Draft',
      color: '#000',
      position: 0,
      filterGroups: [{ filter: {} }],
      sorts: [{ field: 'color', dir: 'asc' }],
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      createdAt: 0,
      updatedAt: 0,
    },
    effectivePocketSize: 9,
    effectiveSorts: [{ field: 'color', dir: 'asc' }],
    displaySorts: [],
    sections: [white],
    totalCards: 9,
    totalPages: 1,
    totalValue: 0,
  };
}

describe('BinderEditorPreviewStrip', () => {
  it('shows a loading placeholder while cards hydrate', () => {
    render(
      <BinderEditorPreviewStrip binder={null} loading fixedCapacity={null} binderName="Draft" />
    );
    expect(screen.getByText(/loading your cards/i)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows an honest empty state when nothing lands here', () => {
    const empty: MaterializedBinder = {
      ...fakeBinder(),
      sections: [],
      totalCards: 0,
      totalPages: 0,
    };
    render(
      <BinderEditorPreviewStrip
        binder={empty}
        loading={false}
        fixedCapacity={null}
        binderName="Draft"
      />
    );
    expect(screen.getByText(/nothing to preview/i)).toBeTruthy();
  });

  it('summarizes pages, the first section and capacity', () => {
    render(
      <BinderEditorPreviewStrip
        binder={fakeBinder()}
        loading={false}
        fixedCapacity={18}
        binderName="Draft"
      />
    );
    expect(screen.getByText(/1 page/)).toBeTruthy();
    expect(screen.getByText(/1 binder of 18/)).toBeTruthy();
    expect(screen.getByText(/Starts with White, 9 cards/)).toBeTruthy();
  });

  it('opens the page viewer on the draft pages when tapped', () => {
    render(
      <BinderEditorPreviewStrip
        binder={fakeBinder()}
        loading={false}
        fixedCapacity={null}
        binderName="Rares worth $1+"
      />
    );
    expect(screen.queryByTestId('page-viewer')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('page-viewer').textContent).toContain('Rares worth $1+');
    expect(lastPagesProps?.pages).toHaveLength(1);
  });
});
