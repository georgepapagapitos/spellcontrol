// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeckSizePrompt, type SizePromptOption } from './DeckSizePrompt';

function opt(name: string, onPick = vi.fn()): SizePromptOption {
  return { key: name, name, roleLabel: 'Ramp', hint: 'same role', onPick };
}

function renderPrompt(over: Partial<Parameters<typeof DeckSizePrompt>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <DeckSizePrompt
      title="Deck is full (99/99)"
      subtitle="Replace a card with Smothering Tithe?"
      actionVerb="Replace"
      options={[opt('Mind Stone'), opt('Hedron Archive')]}
      footer={[{ label: 'Cancel', onClick: onClose, primary: true }]}
      onClose={onClose}
      {...over}
    />
  );
  return { onClose };
}

describe('DeckSizePrompt', () => {
  it('renders the title, subtitle, and option rows with the action verb', () => {
    renderPrompt();
    expect(screen.getByText('Deck is full (99/99)')).toBeTruthy();
    expect(screen.getByText('Replace a card with Smothering Tithe?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace Mind Stone' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace Hedron Archive' })).toBeTruthy();
  });

  it('fires an option onPick when its action is clicked', () => {
    const pick = vi.fn();
    renderPrompt({ options: [opt('Mind Stone', pick)] });
    fireEvent.click(screen.getByRole('button', { name: 'Replace Mind Stone' }));
    expect(pick).toHaveBeenCalledOnce();
  });

  it('reveals moreOptions behind "Pick another card…"', () => {
    renderPrompt({ moreOptions: [opt('Arcane Signet')] });
    // Hidden until revealed.
    expect(screen.queryByRole('button', { name: 'Replace Arcane Signet' })).toBeNull();
    fireEvent.click(screen.getByText('Pick another card…'));
    expect(screen.getByRole('button', { name: 'Replace Arcane Signet' })).toBeTruthy();
  });

  it('runs footer actions (e.g. Cancel → onClose)', () => {
    const { onClose } = renderPrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on backdrop click', () => {
    const { onClose } = renderPrompt();
    fireEvent.click(document.querySelector('.card-picker-root')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an empty hint when there are no suggested options', () => {
    renderPrompt({ options: [] });
    expect(screen.getByText(/No suggestions/)).toBeTruthy();
  });

  it('disables option + footer buttons while busy', () => {
    renderPrompt({ busy: true });
    expect(screen.getByRole('button', { name: 'Replace Mind Stone' })).toHaveProperty(
      'disabled',
      true
    );
  });
});
