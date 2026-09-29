// @vitest-environment happy-dom
import { useState } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiFeaturesSettings } from './AiFeaturesSettings';
import type { AiStatus } from '../../lib/ai-review';

const setAiOptInMock = vi.fn();

vi.mock('../../lib/ai-review', () => ({
  setAiOptIn: (enabled: boolean) => setAiOptInMock(enabled),
}));

vi.mock('../../store/toasts', () => ({
  toast: { show: vi.fn() },
}));

/** The You page owns the status; this stands in for it. */
function Host({ initial }: { initial: AiStatus }) {
  const [status, setStatus] = useState(initial);
  return <AiFeaturesSettings status={status} onStatusChange={setStatus} />;
}

const OFF = { optIn: false, used: 0, limit: 5 } as AiStatus;

describe('AiFeaturesSettings', () => {
  beforeEach(() => {
    setAiOptInMock.mockReset();
  });

  it('renders a switch that reflects the current opt-in state', () => {
    render(<Host initial={OFF} />);
    const row = screen.getByRole('switch', { name: 'AI deck analysis' });
    expect(row.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Off.')).toBeTruthy();
  });

  it('toggling the switch calls setAiOptIn and hands the new status up', async () => {
    setAiOptInMock.mockResolvedValue(true);
    render(<Host initial={OFF} />);
    const row = screen.getByRole('switch', { name: 'AI deck analysis' });

    fireEvent.click(row);
    expect(setAiOptInMock).toHaveBeenCalledWith(true);
    await waitFor(() => expect(row.getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByText(/5 requests per day/)).toBeTruthy();
  });

  it('disables the switch and shows a saving hint while the request is in flight', async () => {
    let resolveOptIn: (v: boolean) => void = () => {};
    setAiOptInMock.mockReturnValue(new Promise<boolean>((resolve) => (resolveOptIn = resolve)));
    render(<Host initial={OFF} />);
    const row = screen.getByRole('switch', { name: 'AI deck analysis' });

    fireEvent.click(row);
    expect(row.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Saving…')).toBeTruthy();

    resolveOptIn(true);
    await waitFor(() => expect(row.hasAttribute('disabled')).toBe(false));
  });
});
