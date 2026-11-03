// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PricesSection } from './PricesSection';
import { _resetOwnedAlertsForTests, useOwnedAlertStore } from '@/lib/collection/owned-price-alerts';

describe('PricesSection owned-card alerts', () => {
  beforeEach(() => _resetOwnedAlertsForTests());

  it('starts off with the threshold controls hidden', () => {
    render(<PricesSection />);
    const sw = screen.getByRole('switch', { name: 'Alert on cards you own' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('radio', { name: '25%' })).toBeNull();
  });

  it('gives the alert switch a real hint, never a bare repeat of its On/Off value', () => {
    render(<PricesSection />);
    expect(screen.queryByText('Off.')).toBeNull();
    expect(screen.getByText(/Flags cards you own that spike or dip/)).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Alert on cards you own' }));
    expect(screen.queryByText(/^On\./)).toBeNull();
    expect(screen.getByText(/past both limits show in Waiting on you/)).toBeTruthy();
  });

  it('switching on reveals direction, percent and amount, and each choice is saved', () => {
    render(<PricesSection />);
    fireEvent.click(screen.getByRole('switch', { name: 'Alert on cards you own' }));
    expect(useOwnedAlertStore.getState().settings.enabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Spikes' }));
    fireEvent.click(screen.getByRole('radio', { name: '50%' }));
    fireEvent.click(screen.getByRole('radio', { name: '$5.00' }));
    expect(useOwnedAlertStore.getState().settings).toMatchObject({
      enabled: true,
      direction: 'up',
      minPercent: 50,
      minAmount: 5,
    });
  });
});
