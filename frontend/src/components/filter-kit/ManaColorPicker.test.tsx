// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ManaColorPicker } from './ManaColorPicker';
import { COLOR_MODE_LABELS, colorModeHint, colorModeOptions } from './color-modes';

const MODES = colorModeOptions(['any', 'all', 'within']);
const noop = () => {};

describe('colorModeHint', () => {
  it('says what each mode matches', () => {
    expect(colorModeHint(['U', 'G'], 'any')).toBe(
      'Cards that are blue or green, including multicolor cards.'
    );
    expect(colorModeHint(['U', 'G'], 'all')).toBe(
      'Only cards whose colors are exactly blue and green.'
    );
    expect(colorModeHint(['U', 'G'], 'within')).toBe(
      'Cards that fit a blue-green deck. Colorless cards included.'
    );
  });
  it('prompts with no colors and stays silent for an unknown mode', () => {
    expect(colorModeHint([], 'any')).toBe('No color filter. Pick one or more colors.');
    expect(colorModeHint(['U'], 'custom')).toBe('');
  });
  it('labels the three modes', () => {
    expect(COLOR_MODE_LABELS).toEqual({
      any: 'Any of these',
      all: 'Exactly these',
      within: 'Within these',
    });
  });
});

describe('ManaColorPicker', () => {
  it('renders a named toggle pip per color, pressed when picked', () => {
    const onColorsChange = vi.fn();
    render(
      <ManaColorPicker
        colors={['U']}
        onColorsChange={onColorsChange}
        mode="any"
        modes={MODES}
        onModeChange={noop}
      />
    );
    const group = screen.getByRole('group', { name: 'Filter by color' });
    expect(group.querySelectorAll('button')).toHaveLength(6);
    expect(group.querySelectorAll('.ms-cost')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Blue' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Colorless' }).getAttribute('aria-pressed')).toBe(
      'false'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));
    expect(onColorsChange).toHaveBeenLastCalledWith(['U', 'G']);
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    expect(onColorsChange).toHaveBeenLastCalledWith([]);
  });

  it('offers Multicolor on request', () => {
    const { rerender } = render(
      <ManaColorPicker
        colors={[]}
        onColorsChange={noop}
        mode="any"
        modes={MODES}
        onModeChange={noop}
      />
    );
    expect(screen.queryByRole('button', { name: 'Multicolor' })).toBeNull();
    rerender(
      <ManaColorPicker
        includeMulticolor
        colors={[]}
        onColorsChange={noop}
        mode="any"
        modes={MODES}
        onModeChange={noop}
      />
    );
    expect(screen.getByRole('button', { name: 'Multicolor' })).toBeTruthy();
  });

  it('has a radio mode control and a polite hint', () => {
    const onModeChange = vi.fn();
    render(
      <ManaColorPicker
        colors={['U']}
        onColorsChange={noop}
        mode="any"
        modes={MODES}
        onModeChange={onModeChange}
        hint={colorModeHint(['U'], 'any')}
      />
    );
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect((screen.getByRole('radio', { name: 'Any of these' }) as HTMLInputElement).checked).toBe(
      true
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Within these' }));
    expect(onModeChange).toHaveBeenLastCalledWith('within');
    const hint = screen.getByText('Cards that are blue, including multicolor cards.');
    expect(hint.getAttribute('aria-live')).toBe('polite');
  });

  it('omits the hint when none is given', () => {
    const { container } = render(
      <ManaColorPicker
        colors={[]}
        onColorsChange={noop}
        mode="any"
        modes={MODES}
        onModeChange={noop}
      />
    );
    expect(container.querySelector('.filter-kit-hint')).toBeNull();
  });
});
