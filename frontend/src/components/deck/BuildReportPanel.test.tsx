// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BuildReport } from '@/deck-builder/types';
import { BuildReportPanel } from './BuildReportPanel';

function makeReport(overrides: Partial<BuildReport> = {}): BuildReport {
  return {
    targetBracket: 3,
    estimatedBracket: 3,
    dataSource: 'theme+bracket',
    builtFromCollection: true,
    ownedPercentActual: 84,
    ...overrides,
  };
}

describe('BuildReportPanel', () => {
  it('renders the aimed vs estimated bracket line', () => {
    const { container } = render(<BuildReportPanel report={makeReport()} />);
    const line = container.querySelector('.build-report-bracket');
    expect(line?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Aimed Bracket 3 → estimated 3');
  });

  it('humanizes the data source (base fallback)', () => {
    render(<BuildReportPanel report={makeReport({ dataSource: 'base' })} />);
    expect(screen.getByText('used base EDHREC pool (bracket list unavailable)')).toBeTruthy();
  });

  it('humanizes the scryfall fallback', () => {
    render(<BuildReportPanel report={makeReport({ dataSource: 'scryfall' })} />);
    expect(screen.getByText('used Scryfall search (no EDHREC data available)')).toBeTruthy();
  });

  it('shows the owned-from-collection percentage', () => {
    const { container } = render(<BuildReportPanel report={makeReport()} />);
    expect(container.textContent).toContain('84%');
    expect(container.textContent).toContain('from your collection');
  });

  it('shows the owned target for partial collection builds', () => {
    const { container } = render(
      <BuildReportPanel
        report={makeReport({
          collectionStrategy: 'partial',
          ownedPercentActual: 60,
          ownedPercentTarget: 75,
        })}
      />
    );
    expect(container.textContent).toContain('target 75%');
  });

  it('shows padded basics when present', () => {
    const { container } = render(<BuildReportPanel report={makeReport({ basicsPadded: 4 })} />);
    expect(container.textContent?.replace(/\s+/g, ' ')).toContain('padded 4 basics');
  });

  it('omits padded basics when zero', () => {
    const { container } = render(<BuildReportPanel report={makeReport({ basicsPadded: 0 })} />);
    expect(container.textContent).not.toContain('padded');
  });

  it('renders role gaps as have / target with humanized labels', () => {
    const { container } = render(
      <BuildReportPanel
        report={makeReport({
          roleGaps: [
            { role: 'cardDraw', have: 9, want: 10 },
            { role: 'ramp', have: 8, want: 10 },
          ],
        })}
      />
    );
    expect(screen.getByText('Role gaps')).toBeTruthy();
    const gaps = container.querySelectorAll('.build-report-gap');
    expect(gaps.length).toBe(2);

    // Canonical label from ROLE_TITLES — never the raw "cardDraw" key.
    expect(gaps[0].textContent).toContain('Card Advantage');
    expect(gaps[0].textContent).not.toContain('cardDraw');
    expect(gaps[1].textContent).toContain('Ramp');

    // Reads as have / target: count emphasized, target muted.
    expect(gaps[0].querySelector('.build-report-gap-label')?.textContent).toBe('Card Advantage');
    const count = gaps[0].querySelector('.build-report-gap-count');
    expect(count?.textContent?.replace(/\s+/g, ' ').trim()).toBe('9 / 10');
    expect(
      count?.querySelector('.build-report-gap-target')?.textContent?.replace(/\s+/g, ' ')
    ).toBe(' / 10');
  });

  it('humanizes an unknown role key (camelCase fallback)', () => {
    const { container } = render(
      <BuildReportPanel
        report={makeReport({ roleGaps: [{ role: 'fastMana', have: 1, want: 3 }] })}
      />
    );
    const gap = container.querySelector('.build-report-gap-label');
    expect(gap?.textContent).toBe('Fast Mana');
  });

  it('does not render the collection line for non-collection builds', () => {
    const { container } = render(
      <BuildReportPanel
        report={makeReport({ builtFromCollection: false, ownedPercentActual: undefined })}
      />
    );
    expect(container.textContent).not.toContain('from your collection');
  });
});
