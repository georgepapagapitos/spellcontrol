// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WinConditionPanel } from './WinConditionPanel';
import type {
  WinConditionAnalysis,
  WinCondition,
} from '@/deck-builder/services/winConditions/types';

function wincon(overrides: Partial<WinCondition> = {}): WinCondition {
  return {
    category: 'burn',
    label: 'Burn',
    summary: '5 direct-damage spells',
    evidence: ['Fireball', 'Comet Storm'],
    score: 5,
    ...overrides,
  };
}

function analysis(overrides: Partial<WinConditionAnalysis> = {}): WinConditionAnalysis {
  return {
    primary: null,
    secondary: [],
    noClearWinCondition: true,
    ...overrides,
  };
}

describe('WinConditionPanel — E125 tag cross-link', () => {
  it('engine-only: renders evidence with an untagged toggle, no "Tagged by you" section', () => {
    render(
      <WinConditionPanel
        analysis={analysis({ primary: wincon(), noClearWinCondition: false })}
        onToggleWinConTag={vi.fn()}
      />
    );

    expect(screen.getByText('Burn')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Tag Fireball as Wincon' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText('Tagged by you')).toBeNull();
  });

  it('tag-only: no engine path, but a tagged card still surfaces in its own section', () => {
    render(
      <WinConditionPanel
        analysis={analysis()}
        winConTags={['Craterhoof Behemoth']}
        onToggleWinConTag={vi.fn()}
      />
    );

    expect(screen.getByText('No clear win condition detected')).toBeTruthy();
    expect(screen.getByText('Tagged by you')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Untag Craterhoof Behemoth as Wincon' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('both: a tag matching engine evidence marks that row and is not duplicated', () => {
    render(
      <WinConditionPanel
        analysis={analysis({ primary: wincon(), noClearWinCondition: false })}
        winConTags={['Fireball']}
        onToggleWinConTag={vi.fn()}
      />
    );

    // Marked in place on the Burn row...
    const toggle = screen.getByRole('button', { name: 'Untag Fireball as Wincon' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    // ...and not duplicated into a separate tagged-only section.
    expect(screen.queryByText('Tagged by you')).toBeNull();
  });

  it('none: no engine path and no tags renders only the empty state', () => {
    render(<WinConditionPanel analysis={analysis()} />);

    expect(screen.getByText('No clear win condition detected')).toBeTruthy();
    expect(screen.queryByText('Tagged by you')).toBeNull();
  });

  it('fires onToggleWinConTag with the card name on click', () => {
    const onToggle = vi.fn();
    render(
      <WinConditionPanel
        analysis={analysis({ primary: wincon(), noClearWinCondition: false })}
        onToggleWinConTag={onToggle}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tag Fireball as Wincon' }));
    expect(onToggle).toHaveBeenCalledWith('Fireball');
  });

  it('renders every chip read-only (no tag button) when onToggleWinConTag is omitted', () => {
    render(
      <WinConditionPanel analysis={analysis({ primary: wincon(), noClearWinCondition: false })} />
    );

    expect(screen.queryByRole('button', { name: /Wincon/ })).toBeNull();
    // The preview affordance still works.
    expect(screen.getByRole('button', { name: 'Preview Fireball' })).toBeTruthy();
  });

  it('splits a mixed tag set: matched evidence marks in place, the rest gets its own section', () => {
    render(
      <WinConditionPanel
        analysis={analysis({ primary: wincon(), noClearWinCondition: false })}
        winConTags={['Fireball', 'Craterhoof Behemoth']}
        onToggleWinConTag={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Untag Fireball as Wincon' })).toBeTruthy();
    expect(screen.getByText('Tagged by you')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Untag Craterhoof Behemoth as Wincon' })
    ).toBeTruthy();
  });
});

describe('WinConditionPanel — the clock is kill-categories only', () => {
  /** A minimal library the clock can actually run over: 20 lands + the piece. */
  const library = [
    ...Array.from({ length: 20 }, (_, i) => ({
      name: `Land ${i}`,
      cmc: 0,
      isLand: true,
      role: null,
      colors: [],
    })),
    { name: 'Thassa’s Oracle', cmc: 2, isLand: false, role: null, colors: [] },
  ];

  it('shows a kill turn for an alt-win path', () => {
    render(
      <WinConditionPanel
        analysis={analysis({
          primary: wincon({
            category: 'alt-win',
            label: 'Alt-win',
            evidence: ['Thassa’s Oracle'],
            assembly: [{ names: ['Thassa’s Oracle'], need: 1 }],
          }),
          noClearWinCondition: false,
        })}
        library={library}
      />
    );
    // Assembled, never 'kills': the sentence leads with the early turn.
    expect(screen.getByText(/^The win card is cast by turn 6 /)).toBeTruthy();
    expect(screen.queryByText(/kills/)).toBeNull();
    // The strip spells every column out for a screen reader.
    expect(
      screen.getByRole('img', { name: /^Share of games with it assembled: by turn 4, / })
    ).toBeTruthy();
    expect(screen.getByText(/Combat and poison damage aren't simulated\./)).toBeTruthy();
  });

  it('hides the clock for a strategic mass, keeping the path and its evidence', () => {
    // That number tracked evidence-pool SIZE, not deck speed — a real go-wide
    // deck measured turn 41 off a 5-card pool. See isKillClock.
    render(
      <WinConditionPanel
        analysis={analysis({
          primary: wincon({
            category: 'go-wide',
            label: 'Go wide',
            evidence: ['Thassa’s Oracle'],
            assembly: [{ names: ['Thassa’s Oracle'], need: 1 }],
          }),
          noClearWinCondition: false,
        })}
        library={library}
      />
    );
    expect(screen.queryByText(/by turn/)).toBeNull();
    // The path itself still renders — only the misleading number is gone.
    expect(screen.getByText('Go wide')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preview Thassa’s Oracle' })).toBeTruthy();
  });
});

// E380: three Sensei's Divining Top loops are complete combos that draw the
// library and stop. "Add a combo" above them read as if the combos were missed.
describe('WinConditionPanel — combos that do not end the game', () => {
  it('says the combos need a payoff instead of asking for a combo', () => {
    render(<WinConditionPanel analysis={analysis({ loopsWithoutPayoff: 3 })} />);
    expect(
      screen.getByText(/^The 3 combos in this deck don't end the game on their own\./)
    ).toBeTruthy();
    expect(screen.queryByText(/Add a combo/)).toBeNull();
  });

  it('keeps the general advice when the deck has no combos', () => {
    render(<WinConditionPanel analysis={analysis({ loopsWithoutPayoff: 0 })} />);
    expect(screen.getByText(/Add a combo, a damage plan/)).toBeTruthy();
  });
});

// Before the combo match answers, "No clear win condition. Add a combo" was
// advice to a deck whose win may be the very combo that hadn't been counted.
describe('WinConditionPanel before combos are counted', () => {
  it('says the answer waits for the combo check instead of warning', () => {
    render(<WinConditionPanel analysis={analysis()} combosUncounted />);
    expect(screen.getByText('Win condition unclear until combos are counted')).toBeTruthy();
    expect(screen.queryByText('No clear win condition detected')).toBeNull();
    expect(screen.queryByText(/Add a combo/)).toBeNull();
  });

  it('keeps the warning once combos are counted', () => {
    render(<WinConditionPanel analysis={analysis()} />);
    expect(screen.getByText('No clear win condition detected')).toBeTruthy();
  });
});
