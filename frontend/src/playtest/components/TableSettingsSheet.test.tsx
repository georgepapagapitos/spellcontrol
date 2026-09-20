// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TableSettingsSheet } from './TableSettingsSheet';

function links(onOpen = vi.fn()) {
  return [
    { label: 'Takeback rule', value: 'Free', onOpen },
    { label: 'Resistance', value: 'Off', onOpen },
    { label: 'Designations', value: 'None', onOpen },
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
      ['Designations', 'None'],
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
 * this), and the two rows must be separate groups or picking a felt would
 * clear the sleeve.
 */
describe('TableSettingsSheet — how the table looks (E347)', () => {
  function renderSkin(felt = 'theme', sleeve = 'original') {
    const onFelt = vi.fn();
    const onSleeve = vi.fn();
    render(
      <TableSettingsSheet
        skin={{ felt, sleeve, onFelt, onSleeve }}
        links={links()}
        onClose={vi.fn()}
      />
    );
    return { onFelt, onSleeve };
  }

  it('picks a felt and a sleeve, each from its own group', () => {
    const { onFelt, onSleeve } = renderSkin();
    const felt = screen.getByRole('group', { name: 'Felt' });
    const sleeves = screen.getByRole('group', { name: 'Sleeves' });
    expect(within(felt).getByRole('radio', { name: 'Theme' })).toBeTruthy();

    fireEvent.click(within(felt).getByRole('radio', { name: 'Green' }));
    expect(onFelt).toHaveBeenCalledWith('green');
    fireEvent.click(within(sleeves).getByRole('radio', { name: 'Purple' }));
    expect(onSleeve).toHaveBeenCalledWith('purple');

    const names = (el: HTMLElement) =>
      within(el)
        .getAllByRole('radio')
        .map((r) => (r as HTMLInputElement).name);
    expect(new Set([...names(felt), ...names(sleeves)]).size).toBe(2);
  });

  it('checks the swatch that is in use', () => {
    renderSkin('wine', 'red');
    const felt = screen.getByRole('group', { name: 'Felt' });
    expect((within(felt).getByRole('radio', { name: 'Wine' }) as HTMLInputElement).checked).toBe(
      true
    );
    const sleeves = screen.getByRole('group', { name: 'Sleeves' });
    expect((within(sleeves).getByRole('radio', { name: 'Red' }) as HTMLInputElement).checked).toBe(
      true
    );
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
