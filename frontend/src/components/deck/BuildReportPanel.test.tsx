// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

  it('shows a "see cards to add" CTA that fires onFixGaps, only when the callback is given', () => {
    const onFixGaps = vi.fn();
    const report = makeReport({ roleGaps: [{ role: 'removal', have: 8, want: 12 }] });

    // No callback → informational only, no button.
    const { unmount } = render(<BuildReportPanel report={report} />);
    expect(screen.queryByRole('button', { name: /cards to add/i })).toBeNull();
    unmount();

    // With callback → actionable CTA that jumps to the fix-gaps lane.
    render(<BuildReportPanel report={report} onFixGaps={onFixGaps} />);
    const cta = screen.getByRole('button', { name: /cards to add/i });
    fireEvent.click(cta);
    expect(onFixGaps).toHaveBeenCalledTimes(1);
  });

  it('renders no CTA when there are no role gaps even if onFixGaps is given', () => {
    render(<BuildReportPanel report={makeReport()} onFixGaps={() => {}} />);
    expect(screen.queryByRole('button', { name: /cards to add/i })).toBeNull();
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

  describe('synergyFills (off-EDHREC fill provenance)', () => {
    it('is absent when there are no fills', () => {
      const { container } = render(<BuildReportPanel report={makeReport()} />);
      expect(container.textContent).not.toContain('had no EDHREC data');
    });

    it('shows the tag-match reason when matchedTags is non-empty and there is no lift', () => {
      render(
        <BuildReportPanel
          report={makeReport({ synergyFills: [{ name: 'Fill A', matchedTags: ['ramp'] }] })}
        />
      );
      expect(screen.getByText('Fits your deck’s ramp')).toBeTruthy();
    });

    it('shows the lift-flavored reason when liftedBy is present and there are no matched tags', () => {
      render(
        <BuildReportPanel
          report={makeReport({
            synergyFills: [{ name: 'Fill A', matchedTags: [], liftedBy: ['Sol Ring'] }],
          })}
        />
      );
      expect(screen.getByText('Lifted by Sol Ring')).toBeTruthy();
    });

    it('combines tag match and lift into one terse reason when both are present', () => {
      render(
        <BuildReportPanel
          report={makeReport({
            synergyFills: [
              { name: 'Fill A', matchedTags: ['ramp'], liftedBy: ['Sol Ring', 'Rhystic Study'] },
            ],
          })}
        />
      );
      expect(
        screen.getByText('Fits your deck’s ramp · Lifted by Sol Ring, Rhystic Study')
      ).toBeTruthy();
    });

    it('falls back to the slot-filler line when neither tags nor lift are present', () => {
      render(
        <BuildReportPanel
          report={makeReport({ synergyFills: [{ name: 'Fill A', matchedTags: [] }] })}
        />
      );
      expect(screen.getByText('Slot filler — no shared synergy with the deck')).toBeTruthy();
    });
  });

  describe('hidden-synergy package picks', () => {
    it('is absent when there are no picks', () => {
      const { container } = render(<BuildReportPanel report={makeReport()} />);
      expect(container.textContent).not.toContain('hidden-synergy');
    });

    it('renders a bomb pick with its reason and chips (combo-style + owned)', () => {
      const { container } = render(
        <BuildReportPanel
          report={makeReport({
            packagePicks: [
              {
                name: 'Bomb Card',
                kind: 'bomb',
                liftedBy: ['Sol Ring'],
                lowSample: false,
                owned: true,
              },
            ],
          })}
        />
      );
      expect(screen.getByText('Bomb Card')).toBeTruthy();
      expect(screen.getByText('Pairs hard with Sol Ring')).toBeTruthy();
      expect(screen.getByText('Combo-style pairing')).toBeTruthy();
      expect(screen.getByText('Owned')).toBeTruthy();
      expect(container.textContent).not.toContain('Low sample');
    });

    it('renders a cluster pick with its liftedBy list and unowned/low-sample chips', () => {
      render(
        <BuildReportPanel
          report={makeReport({
            packagePicks: [
              {
                name: 'Cluster Card',
                kind: 'cluster',
                liftedBy: ['Card A', 'Card B'],
                lowSample: true,
                owned: false,
              },
            ],
          })}
        />
      );
      expect(screen.getByText('Lifted by Card A, Card B')).toBeTruthy();
      expect(screen.getByText('Cluster pick')).toBeTruthy();
      expect(screen.getByText('Low sample')).toBeTruthy();
      expect(screen.getByText('Not owned')).toBeTruthy();
    });

    it('renders the disclosure footnote when present', () => {
      const { container } = render(
        <BuildReportPanel
          report={makeReport({
            packagePicks: [
              {
                name: 'Bomb Card',
                kind: 'bomb',
                liftedBy: ['Sol Ring'],
                lowSample: false,
                owned: true,
              },
            ],
            liftPicksNote: '2 higher-lift candidates hidden: over budget cap',
          })}
        />
      );
      expect(screen.getByText('2 higher-lift candidates hidden: over budget cap')).toBeTruthy();
      expect(container.querySelector('.build-report-lift-note')).toBeTruthy();
    });

    it('omits the footnote when absent', () => {
      const { container } = render(
        <BuildReportPanel
          report={makeReport({
            packagePicks: [
              {
                name: 'Bomb Card',
                kind: 'bomb',
                liftedBy: ['Sol Ring'],
                lowSample: false,
                owned: true,
              },
            ],
          })}
        />
      );
      expect(container.querySelector('.build-report-lift-note')).toBeNull();
    });
  });

  describe('one-tap add', () => {
    const pickReport = makeReport({
      synergyFills: [{ name: 'Fill A', matchedTags: ['ramp'] }],
      packagePicks: [
        { name: 'Bomb Card', kind: 'bomb', liftedBy: ['Sol Ring'], lowSample: false, owned: true },
      ],
    });

    it('renders no Add buttons when onAddCard is omitted (read-only sheet usage)', () => {
      render(<BuildReportPanel report={pickReport} />);
      expect(screen.queryByRole('button', { name: /^Add /i })).toBeNull();
    });

    it('fires onAddCard with the row name and flips to "Added" on click', () => {
      const onAddCard = vi.fn();
      render(<BuildReportPanel report={pickReport} onAddCard={onAddCard} />);

      const addBtn = screen.getByRole('button', { name: 'Add Fill A' });
      fireEvent.click(addBtn);

      expect(onAddCard).toHaveBeenCalledWith('Fill A');
      const addedBtn = screen.getByRole('button', { name: 'Added Fill A' });
      expect(addedBtn).toBeTruthy();
      expect(addedBtn.hasAttribute('disabled')).toBe(true);
    });

    it('shows "In deck" (disabled) for a row already in the deck, without needing a click', () => {
      render(
        <BuildReportPanel
          report={pickReport}
          onAddCard={vi.fn()}
          deckCardNames={new Set(['bomb card'])}
        />
      );
      const inDeckBtn = screen.getByRole('button', { name: 'Bomb Card is already in the deck' });
      expect(inDeckBtn.hasAttribute('disabled')).toBe(true);
      // The other row is untouched — still a live "+ Add".
      expect(screen.getByRole('button', { name: 'Add Fill A' })).toBeTruthy();
    });

    it('shows the in-flight spinner state and disables the button while adding', () => {
      render(
        <BuildReportPanel
          report={pickReport}
          onAddCard={vi.fn()}
          addingCardNames={new Set(['Fill A'])}
        />
      );
      const addingBtn = screen.getByRole('button', { name: 'Adding Fill A' });
      expect(addingBtn.hasAttribute('disabled')).toBe(true);
    });
  });

  describe('coherence flags (generation-end audit)', () => {
    it('is absent when there are no findings', () => {
      const { container } = render(<BuildReportPanel report={makeReport()} />);
      expect(container.textContent).not.toContain('coherence flag');
    });

    it('renders per-card findings with kind badges and deck-level notes without a card name', () => {
      const { container } = render(
        <BuildReportPanel
          report={makeReport({
            coherenceFindings: [
              {
                kind: 'dead-payoff',
                severity: 'warn',
                card: 'Academy Manufactor',
                message: 'Its Artifacts payoff has almost nothing feeding it in this deck.',
              },
              {
                kind: 'lopsided-engine',
                severity: 'info',
                message: 'Tokens: 5 producers but no payoff to reward them.',
              },
            ],
          })}
        />
      );
      expect(container.textContent).toContain('2 coherence flags');
      expect(screen.getByText('Academy Manufactor')).toBeTruthy();
      expect(screen.getByText('Dead payoff')).toBeTruthy();
      expect(screen.getByText('Engine note')).toBeTruthy();
      expect(screen.getByText('Tokens: 5 producers but no payoff to reward them.')).toBeTruthy();
    });

    it('labels land-sanity findings with a Land sanity badge', () => {
      render(
        <BuildReportPanel
          report={makeReport({
            coherenceFindings: [
              {
                kind: 'land-sanity',
                severity: 'warn',
                card: 'Flooded Strand',
                message:
                  'It fetches a Plains or Island, but the deck has no land of either basic type for it to find.',
              },
            ],
          })}
        />
      );
      expect(screen.getByText('Flooded Strand')).toBeTruthy();
      expect(screen.getByText('Land sanity')).toBeTruthy();
    });

    it('renders auto-applied repairs — alone and alongside remaining flags', () => {
      const repair = {
        cut: 'Vanilla Beast',
        added: 'Sol Ring',
        reason: 'No EDHREC signal, engine link, role, or combo ties it to this deck.',
      };
      const { container } = render(
        <BuildReportPanel report={makeReport({ coherenceRepairs: [repair] })} />
      );
      expect(container.textContent).toContain('1 coherence swap auto-applied during generation');
      expect(container.textContent).not.toContain('coherence flag');
      expect(screen.getByText('Auto-fixed')).toBeTruthy();
      expect(screen.getByText('Vanilla Beast')).toBeTruthy();
      expect(screen.getByText('Sol Ring')).toBeTruthy();

      const both = render(
        <BuildReportPanel
          report={makeReport({
            coherenceRepairs: [repair],
            coherenceFindings: [
              {
                kind: 'unjustified-slot',
                severity: 'warn',
                card: 'Leftover Card',
                message: 'No EDHREC signal, engine link, role, or combo ties it to this deck.',
              },
            ],
          })}
        />
      );
      expect(both.container.textContent).toContain('1 coherence flag');
      expect(both.container.textContent).toContain('1 coherence swap auto-applied');
    });
  });
});
