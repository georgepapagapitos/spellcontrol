// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TableSettingsSheet } from './TableSettingsSheet';

function links(onOpen = vi.fn()) {
  return [
    { label: 'Takeback rule', value: 'Free', onOpen },
    { label: 'Resistance', value: 'Off', onOpen },
  ];
}

/** `zoom: null` is the narrow tier (no size to set). An explicit `undefined`
 *  would fall through to the default parameter, so the absent case needs its
 *  own value. */
function renderSheet(zoom: number | null = 1, onOpen = vi.fn()) {
  const onZoom = vi.fn();
  const onClose = vi.fn();
  render(
    <TableSettingsSheet
      zoom={zoom === null ? undefined : { value: zoom, min: 0.7, max: 1.5, step: 0.1, onZoom }}
      links={links(onOpen)}
      onClose={onClose}
    />
  );
  return { onZoom, onClose, onOpen };
}

describe('TableSettingsSheet', () => {
  it('shows the card size as a percentage and applies the slider as it moves', () => {
    const { onZoom } = renderSheet(1.3);
    const slider = screen.getByRole('slider', { name: 'Card size' });
    expect(slider.getAttribute('aria-valuetext')).toBe('130%');
    expect(screen.getByText('130%')).toBeTruthy();
    fireEvent.change(slider, { target: { value: '0.8' } });
    expect(onZoom).toHaveBeenCalledWith(0.8);
  });

  it('offers a reset only once the size has moved', () => {
    const { onZoom } = renderSheet(1);
    const reset = screen.getByRole('button', { name: 'Reset card size' });
    expect((reset as HTMLButtonElement).disabled).toBe(true);
    expect(onZoom).not.toHaveBeenCalled();
  });

  it('resets to the default size', () => {
    const { onZoom } = renderSheet(1.2);
    fireEvent.click(screen.getByRole('button', { name: 'Reset card size' }));
    expect(onZoom).toHaveBeenCalledWith(1);
  });
});

describe('the preferences it gathers', () => {
  it('states where each owned-elsewhere setting stands and opens its picker', () => {
    const { onOpen } = renderSheet();
    for (const [label, value] of [
      ['Takeback rule', 'Free'],
      ['Resistance', 'Off'],
    ]) {
      expect(screen.getByRole('button', { name: `${label} ${value}` })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Takeback rule Free' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('drops the card size on the narrow tier, where there is nothing to set', () => {
    renderSheet(null);
    expect(screen.queryByRole('slider', { name: 'Card size' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset card size' })).toBeNull();
    // The rest of the preferences are still offered.
    expect(screen.getByRole('button', { name: 'Resistance Off' })).toBeTruthy();
  });
});

/**
 * E347: the felt and the sleeves are per-device preferences that live here,
 * next to card size — not table-wide state a pod agrees on. The picker is
 * native radios (the `no-aria-only-radiogroups` guard is the other half of
 * this).
 */
describe('TableSettingsSheet — how the table looks', () => {
  function renderSkin(felt = 'theme') {
    const onFelt = vi.fn();
    render(<TableSettingsSheet skin={{ felt, onFelt }} links={links()} onClose={vi.fn()} />);
    return { onFelt };
  }

  it('picks a felt from a real radio group', () => {
    const { onFelt } = renderSkin();
    const felt = screen.getByRole('group', { name: 'Felt' });
    expect(within(felt).getByRole('radio', { name: 'Theme' })).toBeTruthy();
    fireEvent.click(within(felt).getByRole('radio', { name: 'Green' }));
    expect(onFelt).toHaveBeenCalledWith('green');
  });

  it('checks the swatch that is in use', () => {
    renderSkin('wine');
    const felt = screen.getByRole('group', { name: 'Felt' });
    expect((within(felt).getByRole('radio', { name: 'Wine' }) as HTMLInputElement).checked).toBe(
      true
    );
  });

  // The picker was removed; the row must not come back by accident.
  it('offers no sleeve picker', () => {
    renderSkin();
    expect(screen.queryByRole('group', { name: 'Sleeves' })).toBeNull();
    expect(screen.queryByText(/sleeve/i)).toBeNull();
  });

  it('says whose table it is, because a pod setting would read the same', () => {
    renderSkin();
    expect(screen.getByText(/Your table only/)).toBeTruthy();
  });

  it('shows no swatches at all when the caller offers no skin', () => {
    renderSheet();
    expect(screen.queryByRole('group', { name: 'Felt' })).toBeNull();
  });
});

describe('TableSettingsSheet — switches', () => {
  it('renders each toggle as a named switch with its hint, and flips it', () => {
    const onChange = vi.fn();
    render(
      <TableSettingsSheet
        toggles={[
          {
            label: 'Snap cards to grid',
            hint: 'Cards you drop line up on a half-card grid.',
            on: false,
            onChange,
          },
        ]}
        links={links()}
        onClose={vi.fn()}
      />
    );
    const sw = screen.getByRole('switch', { name: 'Snap cards to grid' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Cards you drop line up on a half-card grid.')).toBeTruthy();
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
