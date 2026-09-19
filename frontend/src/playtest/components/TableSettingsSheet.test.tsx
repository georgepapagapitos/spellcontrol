// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TableSettingsSheet } from './TableSettingsSheet';

function renderSheet(zoom = 1) {
  const onZoom = vi.fn();
  const onClose = vi.fn();
  render(
    <TableSettingsSheet
      zoom={zoom}
      min={0.7}
      max={1.5}
      step={0.1}
      onZoom={onZoom}
      onClose={onClose}
    />
  );
  return { onZoom, onClose };
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
    const reset = screen.getByRole('button', { name: 'Reset to default' });
    expect((reset as HTMLButtonElement).disabled).toBe(true);
    expect(onZoom).not.toHaveBeenCalled();
  });

  it('resets to the default size', () => {
    const { onZoom } = renderSheet(1.2);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(onZoom).toHaveBeenCalledWith(1);
  });
});
