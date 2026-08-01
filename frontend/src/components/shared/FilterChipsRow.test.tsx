// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterChipsRow, colorChipLabel } from './FilterChipsRow';

const chip = (id: string, onClear = () => {}) => ({ id, label: id, onClear });

describe('FilterChipsRow', () => {
  it('renders nothing when no filter is active', () => {
    const { container } = render(<FilterChipsRow chips={[]} onClearAll={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('hides "Clear all" for a single chip and shows it for more than one', () => {
    const { rerender } = render(<FilterChipsRow chips={[chip('a')]} onClearAll={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
    rerender(<FilterChipsRow chips={[chip('a'), chip('b')]} onClearAll={() => {}} />);
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeTruthy();
  });

  it('clears only its own slice from a chip ×', () => {
    const clearA = vi.fn();
    const clearB = vi.fn();
    render(<FilterChipsRow chips={[chip('a', clearA), chip('b', clearB)]} onClearAll={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: a' }));
    expect(clearA).toHaveBeenCalledOnce();
    expect(clearB).not.toHaveBeenCalled();
  });
});

describe('colorChipLabel', () => {
  it('maps WUBRGC keys to filter-facing names', () => {
    expect(colorChipLabel(['W', 'U', 'C'])).toBe('White, Blue, Colorless');
  });

  it('falls back to the raw key for anything unmapped', () => {
    expect(colorChipLabel(['W', 'Z'])).toBe('White, Z');
  });
});
