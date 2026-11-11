// @vitest-environment happy-dom
/** "Your deck" (E1113): the recap and the two ways to finish, held when the build can't go. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

vi.mock('@/lib/cards/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cards/card-thumbs')>()),
  useCardThumb: () => undefined,
}));

import { YourDeckAside } from './YourDeckAside';

const card = { id: 'k', name: 'Krenko, Mob Boss' } as ScryfallCard;
const props = {
  card,
  partner: null,
  recap: [
    ['Commander', 'Krenko, Mob Boss'],
    ['Method', 'EDHREC'],
  ] as const,
  hint: 'A full 100 drafted from EDHREC data.',
  blocking: null,
  error: null,
  generateLabel: 'Generate deck',
  isBuilding: false,
  publishing: false,
  canBuild: true,
  canGenerate: true,
  busy: false,
  onBlank: vi.fn(),
  onGenerate: vi.fn(),
};

describe('YourDeckAside', () => {
  it('recaps the choices and runs both actions', () => {
    const onGenerate = vi.fn();
    const onBlank = vi.fn();
    render(<YourDeckAside {...props} onGenerate={onGenerate} onBlank={onBlank} />);
    expect(screen.getByText('EDHREC')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Generate deck' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start blank' }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onBlank).toHaveBeenCalledTimes(1);
  });

  it('holds both buttons and says why when the commander cannot build', () => {
    render(
      <YourDeckAside
        {...props}
        canBuild={false}
        canGenerate={false}
        blocking="Llanowar Elves can't lead a deck here."
      />
    );
    expect(screen.getByRole('status').textContent).toContain("can't lead");
    expect(
      (screen.getByRole('button', { name: 'Generate deck' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Start blank' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('holds Generate alone while the method has nothing to build from, and shows progress and errors', () => {
    render(
      <YourDeckAside {...props} canGenerate={false} error="EDHREC didn't answer." isBuilding busy />
    );
    expect(screen.getByRole('alert').textContent).toContain("didn't answer");
    expect(screen.getByRole('button', { name: 'Building…' })).toBeTruthy();
  });

  it('holds only Generate for an unfinished art motif but lets Start blank through', () => {
    render(<YourDeckAside {...props} canGenerate={false} />);
    expect(
      (screen.getByRole('button', { name: 'Start blank' }) as HTMLButtonElement).disabled
    ).toBe(false);
  });
});
