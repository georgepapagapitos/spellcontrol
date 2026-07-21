// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockSearchCommanders } = vi.hoisted(() => ({ mockSearchCommanders: vi.fn() }));
vi.mock('@/lib/discover-client', () => ({ searchCommanders: mockSearchCommanders }));

import { CommanderTypeahead } from './CommanderTypeahead';

function getInput(): HTMLInputElement {
  return screen.getByRole('combobox', { name: /filter by commander/i });
}

describe('CommanderTypeahead', () => {
  beforeEach(() => {
    mockSearchCommanders.mockReset();
  });

  it('shows no listbox for an empty input', () => {
    render(<CommanderTypeahead value={null} onChange={vi.fn()} />);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('debounce fires the search once per settled input, not once per keystroke', async () => {
    mockSearchCommanders.mockResolvedValue(['Korvold, Fae-Cursed King']);
    render(<CommanderTypeahead value={null} onChange={vi.fn()} />);

    const input = getInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'k' } });
    fireEvent.change(input, { target: { value: 'ko' } });
    fireEvent.change(input, { target: { value: 'kor' } });

    await waitFor(() => expect(mockSearchCommanders).toHaveBeenCalledTimes(1));
    expect(mockSearchCommanders).toHaveBeenCalledWith('kor');
    await waitFor(() => expect(screen.getByRole('option')).toBeTruthy());
  });

  it('renders a non-interactive "no match" row that is excluded from nav/activedescendant', async () => {
    mockSearchCommanders.mockResolvedValue([]);
    render(<CommanderTypeahead value={null} onChange={vi.fn()} />);

    const input = getInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'zzz' } });

    await waitFor(() => expect(screen.getByText(/no commanders match/i)).toBeTruthy());
    expect(input.getAttribute('aria-activedescendant')).toBeNull();

    // Arrow-key nav is a no-op — no option to land on, no crash.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('selecting a result sets the filter and clears the typed query', async () => {
    mockSearchCommanders.mockResolvedValue(['Korvold, Fae-Cursed King']);
    const onChange = vi.fn();
    render(<CommanderTypeahead value={null} onChange={onChange} />);

    const input = getInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'korvold' } });
    const option = await screen.findByRole('option');
    fireEvent.mouseDown(option);

    expect(onChange).toHaveBeenCalledWith('Korvold, Fae-Cursed King');
    expect(input.value).toBe('');
  });

  it('shows the current selection as a placeholder plus a clear button', () => {
    const onChange = vi.fn();
    render(<CommanderTypeahead value="Atraxa, Praetors' Voice" onChange={onChange} />);
    expect(getInput().placeholder).toBe("Atraxa, Praetors' Voice");
    fireEvent.click(screen.getByRole('button', { name: /clear commander filter/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('Escape closes the listbox without clearing a prior selection', async () => {
    mockSearchCommanders.mockResolvedValue(['Korvold, Fae-Cursed King']);
    const onChange = vi.fn();
    render(<CommanderTypeahead value="Atraxa, Praetors' Voice" onChange={onChange} />);

    const input = getInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'kor' } });
    await screen.findByRole('option');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('arrow-key nav wraps at the list ends', async () => {
    mockSearchCommanders.mockResolvedValue(['Alpha', 'Beta', 'Gamma']);
    render(<CommanderTypeahead value={null} onChange={vi.fn()} />);

    const input = getInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'a' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));

    // Highlight starts at 0 (Alpha). ArrowUp from index 0 wraps to the last option.
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    const options = screen.getAllByRole('option');
    expect(options[2].getAttribute('aria-selected')).toBe('true');

    // ArrowDown from the last option wraps back to the first.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
  });
});
