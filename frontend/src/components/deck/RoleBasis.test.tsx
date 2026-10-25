// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RoleBasis } from './RoleBasis';

const targets = { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 };

function rowOf(name: string): string[] {
  const row = screen.getByRole('rowheader', { name }).closest('tr') as HTMLElement;
  return within(row)
    .getAllByRole('cell')
    .map((c) => c.textContent ?? '');
}

describe('RoleBasis', () => {
  it('lays each target beside the three references and labels measured against estimate', () => {
    const { container } = render(
      <RoleBasis
        targets={targets}
        commanderCounts={{ ramp: 12, removal: 5, boardwipe: 1, cardDraw: 9 }}
        commanderDecks={2431}
        bracket={{ value: 4, stated: true }}
      />
    );
    expect(rowOf('Ramp')).toEqual(['10', '12', '107 to 14', '10']);
    const text = container.textContent ?? '';
    expect(text).toContain('Cmdr (estimate)');
    expect(text).toContain('2,431');
    expect(text).toContain('Avg (measured)');
    expect(text).toContain('across 93 EDHREC average decks');
    expect(text).toContain('Expert (estimate)');
    expect(text).toContain('Bracket 4 (stated)');
    expect(text).toContain('33 to 34 lands');
  });

  it('drops the commander column when there is no EDHREC page', () => {
    const { container } = render(<RoleBasis targets={targets} commanderCounts={null} />);
    expect(screen.queryByRole('columnheader', { name: 'Cmdr' })).toBeNull();
    expect(rowOf('Board wipe')).toEqual(['3', '21 to 3', '6']);
    expect(container.textContent).not.toContain('Cmdr');
    expect(container.textContent).not.toContain('Bracket');
  });

  it('flags a thin commander sample', () => {
    const { container } = render(
      <RoleBasis
        targets={targets}
        commanderCounts={{ ramp: 1, removal: 1, boardwipe: 0, cardDraw: 1 }}
        commanderDecks={12}
      />
    );
    expect(container.textContent).toContain('A small sample');
  });
});
