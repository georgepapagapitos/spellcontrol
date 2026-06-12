// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SaltiestPanel, saltBandWord } from './SaltiestPanel';

describe('saltBandWord', () => {
  it('maps 0 to table-friendly', () => {
    expect(saltBandWord(0)).toBe('table-friendly');
  });

  it('maps 0.4 to table-friendly (boundary below 0.5)', () => {
    expect(saltBandWord(0.4)).toBe('table-friendly');
  });

  it('maps 0.5 to mild', () => {
    expect(saltBandWord(0.5)).toBe('mild');
  });

  it('maps 1.4 to mild (boundary below 1.5)', () => {
    expect(saltBandWord(1.4)).toBe('mild');
  });

  it('maps 1.5 to spicy', () => {
    expect(saltBandWord(1.5)).toBe('spicy');
  });

  it('maps 2.4 to spicy (boundary below 2.5)', () => {
    expect(saltBandWord(2.4)).toBe('spicy');
  });

  it('maps 2.5 to polarizing', () => {
    expect(saltBandWord(2.5)).toBe('polarizing');
  });

  it('maps 4 to polarizing (max scale)', () => {
    expect(saltBandWord(4)).toBe('polarizing');
  });
});

describe('SaltiestPanel', () => {
  const cards = [
    { name: 'Rhystic Study', salt: 2.7 },
    { name: 'Cyclonic Rift', salt: 2.5 },
    { name: 'Sol Ring', salt: 0.9 },
    { name: 'Forest', salt: 0.1 },
  ];

  it('renders a row for each card', () => {
    render(<SaltiestPanel cards={cards} />);
    expect(screen.getByText('Rhystic Study')).toBeTruthy();
    expect(screen.getByText('Cyclonic Rift')).toBeTruthy();
    expect(screen.getByText('Sol Ring')).toBeTruthy();
    expect(screen.getByText('Forest')).toBeTruthy();
  });

  it('shows the raw salt score formatted to 2 decimal places', () => {
    render(<SaltiestPanel cards={cards} />);
    // Rhystic Study: 2.70
    expect(screen.getByText('2.70')).toBeTruthy();
    // Sol Ring: 0.90
    expect(screen.getByText('0.90')).toBeTruthy();
  });

  it('renders a band word chip beside each score', () => {
    render(<SaltiestPanel cards={cards} />);
    // Rhystic Study (2.7) → polarizing; Cyclonic Rift (2.5) → polarizing
    expect(screen.getAllByText('polarizing').length).toBeGreaterThanOrEqual(2);
    // Sol Ring (0.9) → mild
    expect(screen.getByText('mild')).toBeTruthy();
    // Forest (0.1) → table-friendly
    expect(screen.getByText('table-friendly')).toBeTruthy();
  });

  it('shows the avg salt with band word when averageSalt is provided', () => {
    render(<SaltiestPanel cards={cards} averageSalt={1.55} />);
    // 1.55 → spicy
    expect(screen.getByText(/deck avg 1\.55 \(spicy\)/)).toBeTruthy();
  });

  it('omits the avg salt line when averageSalt is not provided', () => {
    render(<SaltiestPanel cards={cards} />);
    expect(screen.queryByText(/deck avg/)).toBeNull();
  });

  it('renders nothing when cards is empty', () => {
    const { container } = render(<SaltiestPanel cards={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('makes each card name a button for tap-to-preview', () => {
    render(<SaltiestPanel cards={cards} />);
    const buttons = screen.getAllByRole('button', { name: /Preview / });
    expect(buttons.length).toBe(cards.length);
  });
});
