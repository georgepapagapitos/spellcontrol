// @vitest-environment happy-dom
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiFeaturesSettings } from './AiFeaturesSettings';

const fetchAiStatusMock = vi.fn();
const setAiOptInMock = vi.fn();

vi.mock('../../lib/ai-review', () => ({
  fetchAiStatus: () => fetchAiStatusMock(),
  setAiOptIn: (enabled: boolean) => setAiOptInMock(enabled),
}));

vi.mock('../../store/toasts', () => ({
  toast: { show: vi.fn() },
}));

describe('AiFeaturesSettings', () => {
  beforeEach(() => {
    fetchAiStatusMock.mockReset();
    setAiOptInMock.mockReset();
  });

  it('renders nothing while the feature is unconfigured', async () => {
    fetchAiStatusMock.mockResolvedValue(null);
    const { container } = render(<AiFeaturesSettings />);
    await waitFor(() => expect(fetchAiStatusMock).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('renders a switch that reflects the current opt-in state', async () => {
    fetchAiStatusMock.mockResolvedValue({ optIn: false, used: 0, limit: 5 });
    render(<AiFeaturesSettings />);
    const row = await screen.findByRole('switch', { name: 'AI deck analysis' });
    expect(row.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Off. Nothing is ever sent.')).toBeTruthy();
  });

  it('toggling the switch calls setAiOptIn and updates the checked state', async () => {
    fetchAiStatusMock.mockResolvedValue({ optIn: false, used: 0, limit: 5 });
    setAiOptInMock.mockResolvedValue(true);
    render(<AiFeaturesSettings />);
    const row = await screen.findByRole('switch', { name: 'AI deck analysis' });

    fireEvent.click(row);
    expect(setAiOptInMock).toHaveBeenCalledWith(true);
    await waitFor(() => expect(row.getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByText(/5 requests per day/)).toBeTruthy();
  });

  it('disables the switch and shows a saving hint while the request is in flight', async () => {
    fetchAiStatusMock.mockResolvedValue({ optIn: false, used: 0, limit: 5 });
    let resolveOptIn: (v: boolean) => void = () => {};
    setAiOptInMock.mockReturnValue(new Promise<boolean>((resolve) => (resolveOptIn = resolve)));
    render(<AiFeaturesSettings />);
    const row = await screen.findByRole('switch', { name: 'AI deck analysis' });

    fireEvent.click(row);
    expect(row.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Saving…')).toBeTruthy();

    resolveOptIn(true);
    await waitFor(() => expect(row.hasAttribute('disabled')).toBe(false));
  });
});
