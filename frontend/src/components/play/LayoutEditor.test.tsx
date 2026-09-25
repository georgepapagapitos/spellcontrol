// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LayoutPicker } from './LayoutEditor';

// A well-formed v1 custom layout for 4 seats (board-layouts.ts:decodeCustomLayout).
const CUSTOM_4P = 'custom:v1~2~r1~1.1.1.1.0;2.1.1.1.0;1.2.1.1.180;2.2.1.1.180';

describe('LayoutPicker (board layout, native radios)', () => {
  it('renders the presets as a native radio group, with the current layout checked', () => {
    render(
      <LayoutPicker
        total={4}
        current="4p-pod"
        shared={false}
        onPick={() => {}}
        onCustomize={() => {}}
      />
    );
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    // 3 presets at 4 players ('4p-sides', '4p-pod', '4p-wide-middle').
    expect(radios).toHaveLength(3);
    expect((screen.getByRole('radio', { name: 'Layout 4p-pod' }) as HTMLInputElement).checked).toBe(
      true
    );
    expect(radios.filter((r) => r.checked)).toHaveLength(1);
  });

  it('calls onPick with the layout id when a preset is picked', () => {
    const onPick = vi.fn();
    render(
      <LayoutPicker
        total={4}
        current="4p-pod"
        shared={false}
        onPick={onPick}
        onCustomize={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Layout 4p-sides' }));
    expect(onPick).toHaveBeenCalledWith('4p-sides');
  });

  it('keeps the Custom option a plain action button, outside the radio group', () => {
    const onCustomize = vi.fn();
    render(
      <LayoutPicker
        total={4}
        current="4p-pod"
        shared={false}
        onPick={() => {}}
        onCustomize={onCustomize}
      />
    );
    const custom = screen.getByRole('button', { name: /Custom/ });
    expect(custom.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(custom);
    expect(onCustomize).toHaveBeenCalled();
  });

  it('marks the Custom option pressed for a custom-encoded current layout', () => {
    render(
      <LayoutPicker
        total={4}
        current={CUSTOM_4P}
        shared={false}
        onPick={() => {}}
        onCustomize={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: /Custom/ }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    // The preset radio group stays unaffected — none of its own options are checked.
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.some((r) => r.checked)).toBe(false);
  });
});
