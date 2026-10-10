// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import fixture from '@/lib/deck-analysis/__fixtures__/tutors.fixture.json';
import type { ScryfallCard } from '@/deck-builder/types';
import { AskYourOwn } from './AskYourOwn';

const named = (name: string) =>
  fixture.cards.find((c) => c.name === name) as unknown as ScryfallCard;
const basic = (n: number): ScryfallCard[] =>
  Array.from(
    { length: n },
    () => ({ name: 'Swamp', type_line: 'Basic Land — Swamp' }) as ScryfallCard
  );

// 99 cards: 37 lands, then the real fixture cards, padded with lands.
const library = [
  named('Living Death'),
  named('Demonic Tutor'),
  named('Vampiric Tutor'),
  named('Worldly Tutor'),
  named('Survival of the Fittest'),
  ...basic(94),
];

const tiles = () =>
  within(screen.getByRole('list', { name: 'Odds for this question' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent);

describe('AskYourOwn', () => {
  it('renders nothing for an empty library', () => {
    const { container } = render(<AskYourOwn library={[]} taggerReady />);
    expect(container.textContent).toBe('');
  });

  it('answers a group question on the play and on the draw', () => {
    render(<AskYourOwn library={library} taggerReady={false} />);
    // First option is Lands (94 of 99); at least 1 by turn 5 is near-certain.
    expect(tiles()).toEqual(['100%On the play', '100%On the draw']);
  });

  it('answers a single card and counts only the tutors that can fetch it', () => {
    render(<AskYourOwn library={library} taggerReady={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Card or group/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Living Death' }));
    // 1 card in 99, 11 / 12 seen by turn 5.
    expect(tiles()).toEqual(['11%On the play', '12%On the draw']);
    const line = screen.getByText(/^With Demonic Tutor and Vampiric Tutor:/);
    expect(line.textContent).toBe(
      'With Demonic Tutor and Vampiric Tutor: 30% on the play · 32% on the draw'
    );
    expect(screen.queryByText(/Worldly Tutor/)).toBeNull();
  });

  it('drops the tutor line when asking for more than one, and clamps typed numbers', () => {
    render(<AskYourOwn library={library} taggerReady={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Card or group/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Living Death' }));
    const howMany = screen.getByLabelText('At least') as HTMLInputElement;
    fireEvent.change(howMany, { target: { value: '2' } });
    expect(screen.queryByText(/^With /)).toBeNull();
    expect(tiles()).toEqual(['0%On the play', '0%On the draw']);
    fireEvent.change(howMany, { target: { value: '' } });
    fireEvent.blur(howMany);
    expect(howMany.value).toBe('1');
  });
});
