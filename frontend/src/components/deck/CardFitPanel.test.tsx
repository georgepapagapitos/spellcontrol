// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CardFitPanel } from './CardFitPanel';
import type { AddFitReport } from '@/lib/card-fit';
import type { ScryfallCard } from '@/deck-builder/types';
import type { RankedCut } from '@/lib/intelligent-cuts';

function scry(name: string, over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: name,
    oracle_id: `o-${name}`,
    name,
    cmc: 2,
    type_line: 'Creature',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...over,
  } as ScryfallCard;
}

const cut = (name: string): RankedCut => ({
  slotId: `slot-${name}`,
  card: scry(name),
  reason: 'Overlapping Tokens',
  related: true,
});

function baseReport(over: Partial<AddFitReport> = {}): AddFitReport {
  return {
    axesHit: [{ axis: 'tokens', label: 'Tokens', side: 'producer' }],
    axesMissed: [],
    axesNew: [],
    curve: { cmc: 2, nonlandAtCmc: 3 },
    role: { role: 'cardDraw', label: 'Card Advantage', countInDeck: 4 },
    color: { withinIdentity: true, colorless: false },
    rankedCuts: [cut('Weak Token Maker')],
    ...over,
  };
}

function renderPanel(
  over: { report?: Partial<AddFitReport>; props?: Record<string, unknown> } = {}
) {
  const onSwapCut = vi.fn();
  const onAddAnyway = vi.fn();
  const onClose = vi.fn();
  render(
    <CardFitPanel
      addCard={scry('Young Pyromancer')}
      report={baseReport(over.report)}
      commanderName="Krenko"
      onSwapCut={onSwapCut}
      onAddAnyway={onAddAnyway}
      onClose={onClose}
      {...over.props}
    />
  );
  return { onSwapCut, onAddAnyway, onClose };
}

describe('CardFitPanel', () => {
  it('renders a positive engine verdict when the add reinforces an invested axis', () => {
    renderPanel();
    expect(screen.getByText('Young Pyromancer')).toBeTruthy();
    expect(screen.getByText(/Strengthens your Tokens engine/)).toBeTruthy();
    expect(screen.getByText(/3 other cards at this cost/)).toBeTruthy();
    expect(screen.getByText(/Card Advantage/)).toBeTruthy();
  });

  it('shows a mixed verdict + new-angle when the add ignores the engine', () => {
    renderPanel({
      report: {
        axesHit: [],
        axesMissed: [{ axis: 'tokens', label: 'Tokens' }],
        axesNew: [{ axis: 'lifegain', label: 'Lifegain', side: 'producer' }],
      },
    });
    expect(screen.getByText(/Doesn't touch your Tokens plan/)).toBeTruthy();
    expect(screen.getByText(/leans Lifegain instead/)).toBeTruthy();
  });

  it('fires onSwapCut with the chosen cut', () => {
    const { onSwapCut } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Replace Weak Token Maker' }));
    expect(onSwapCut).toHaveBeenCalledOnce();
    expect(onSwapCut.mock.calls[0][0].slotId).toBe('slot-Weak Token Maker');
  });

  it('fires onAddAnyway from the footer', () => {
    const { onAddAnyway } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add without cutting' }));
    expect(onAddAnyway).toHaveBeenCalledOnce();
  });

  it('flags an off-identity add and an empty cut list', () => {
    renderPanel({
      report: {
        color: { withinIdentity: false, colorless: false },
        rankedCuts: [],
      },
    });
    expect(screen.getByText(/Outside your commander's color identity/)).toBeTruthy();
    expect(screen.getByText(/No related cut found/)).toBeTruthy();
  });
});
