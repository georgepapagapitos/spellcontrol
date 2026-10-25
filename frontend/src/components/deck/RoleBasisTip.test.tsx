// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RoleBasisTip } from './RoleBasisTip';

const targets = { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 };

function open(): HTMLElement {
  fireEvent.focus(screen.getByRole('button', { name: 'Where the role targets come from' }));
  return screen.getByRole('tooltip');
}

describe('RoleBasisTip', () => {
  it('labels each reference as measured or an estimate and shows the sample sizes', () => {
    render(
      <RoleBasisTip
        targets={targets}
        commanderCounts={{ ramp: 12, removal: 5, boardwipe: 1, cardDraw: 9 }}
        commanderDecks={2431}
        bracket={{ value: 4, stated: true }}
      />
    );
    const tip = open().textContent ?? '';
    expect(tip).toContain(
      'Ramp target 10, this commander 12, average decks 10 (7 to 14), expert 10'
    );
    expect(tip).toContain('This commander (estimate)');
    expect(tip).toContain('2,431');
    expect(tip).toContain('Average decks (measured)');
    expect(tip).toContain('across 93 EDHREC average decks');
    expect(tip).toContain('Expert (estimate)');
    expect(tip).toContain('Bracket 4 (stated)');
    expect(tip).toContain('33 to 34 lands');
  });

  it('falls back to the measured baseline when there is no EDHREC page, and says so', () => {
    render(<RoleBasisTip targets={targets} commanderCounts={null} bracket={null} />);
    const tip = open().textContent ?? '';
    expect(tip).not.toContain('this commander');
    expect(tip).not.toContain('This commander (estimate)');
    expect(tip).toContain('Board wipe target 3, average decks 2 (1 to 3), expert 6');
    expect(tip).not.toContain('Bracket');
  });

  it('flags a thin commander sample', () => {
    render(
      <RoleBasisTip
        targets={targets}
        commanderCounts={{ ramp: 1, removal: 1, boardwipe: 0, cardDraw: 1 }}
        commanderDecks={12}
      />
    );
    expect(open().textContent).toContain('A small sample');
  });
});
