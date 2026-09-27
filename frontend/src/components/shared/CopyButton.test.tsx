// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useToastsStore } from '@/store/toasts';
import { CopyButton, CopyIconButton } from './CopyButton';

const writeText = vi.fn(async (_text: string) => {});

beforeEach(() => {
  writeText.mockClear();
  useToastsStore.getState().clear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CopyButton', () => {
  it('copies the value and swaps its label to Copied, then reverts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<CopyButton value="hello" what="the thing" />);
    const button = screen.getByRole('button', { name: 'Copy' });
    fireEvent.click(button);

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('hello'));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy());

    vi.advanceTimersByTime(1500);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy());
  });

  it('announces the copied state through a live region', async () => {
    const { container } = render(<CopyButton value="hello" what="the thing" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() =>
      expect(container.querySelector('.copy-feedback-announce')?.textContent).toBe('Copied')
    );
  });

  it('accepts a lazy value so building it can wait until the click', async () => {
    const build = vi.fn(() => 'built-lazily');
    render(<CopyButton value={build} what="the thing" />);
    expect(build).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('built-lazily'));
  });

  it('toasts an error and does not swap the label when the copy fails', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    render(<CopyButton value="hello" what="the buy list" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() =>
      expect(useToastsStore.getState().toasts[0]?.message).toBe("Couldn't copy the buy list.")
    );
    expect(useToastsStore.getState().toasts[0]?.tone).toBe('error');
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
  });

  it('renders custom labels and no toast on success', async () => {
    render(<CopyButton value="hello" what="the link" label="Copy link" copiedLabel="Done" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy());
    expect(useToastsStore.getState().toasts).toHaveLength(0);
  });
});

describe('CopyIconButton', () => {
  it('keeps its accessible name stable and swaps the icon, announcing Copied', async () => {
    const { container } = render(
      <CopyIconButton value="hello" what="the log" label="Copy log" icon={<span>icon</span>} />
    );
    const button = screen.getByRole('button', { name: 'Copy log' });
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('hello'));
    // Same accessible name before and after — the live region carries the change.
    expect(screen.getByRole('button', { name: 'Copy log' })).toBeTruthy();
    await waitFor(() =>
      expect(container.querySelector('.copy-feedback-announce')?.textContent).toBe('Copied')
    );
  });

  it('toasts an error on failure', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    render(<CopyIconButton value="hello" what="the log" label="Copy log" icon={<span />} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy log' }));
    await waitFor(() =>
      expect(useToastsStore.getState().toasts[0]?.message).toBe("Couldn't copy the log.")
    );
  });
});
