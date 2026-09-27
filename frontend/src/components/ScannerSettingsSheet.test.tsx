// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ScannerSettingsSheet } from './ScannerSettingsSheet';
import { useScannerSettings } from '../lib/scanner-settings';

const RESET = {
  defaultFinish: 'nonfoil' as const,
  defaultCondition: 'nm' as const,
  defaultLanguage: '',
  sound: true,
  showTotal: true,
};

beforeEach(() => {
  useScannerSettings.setState({ ...RESET });
});

describe('ScannerSettingsSheet (Add settings)', () => {
  it('titles itself "Add settings", shared by the scanner and Add cards', () => {
    render(<ScannerSettingsSheet onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Add settings' })).toBeTruthy();
  });

  it('sets the default finish for new copies', () => {
    render(<ScannerSettingsSheet onClose={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Foil' }));
    expect(useScannerSettings.getState().defaultFinish).toBe('foil');
  });

  it('sets the default condition via the shared ConditionControl', () => {
    render(<ScannerSettingsSheet onClose={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Lightly Played' }));
    expect(useScannerSettings.getState().defaultCondition).toBe('lp');
  });

  it('sets the default language, with English standing where "Not set" stood', () => {
    render(<ScannerSettingsSheet onClose={() => {}} />);
    const trigger = screen.getByRole('button', { name: /Language for new cards/ });
    expect(trigger.textContent).toContain('English');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: 'Japanese' }));
    expect(useScannerSettings.getState().defaultLanguage).toBe('ja');
  });

  it('shows the Scanner section by default (opened from the scanner itself)', () => {
    render(<ScannerSettingsSheet onClose={() => {}} />);
    expect(screen.getByText('Sound on each scan')).toBeTruthy();
    expect(screen.getByText('Show the running total')).toBeTruthy();
  });

  it('hides the Scanner section when told the device cannot scan', () => {
    render(<ScannerSettingsSheet onClose={() => {}} showScannerSection={false} />);
    expect(screen.queryByText('Sound on each scan')).toBeNull();
    expect(screen.queryByText('Show the running total')).toBeNull();
  });

  it('closes via the × button', () => {
    const onClose = vi.fn();
    render(<ScannerSettingsSheet onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
