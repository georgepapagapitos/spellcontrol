// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageSection } from './StorageSection';
import { isSuggestionLabelsEnabled } from '@/lib/util/suggestion-labels';

vi.mock('@/components/settings/OfflineModeSettings', () => ({ OfflineModeSettings: () => null }));

beforeEach(() => localStorage.clear());

describe('Storage > Privacy', () => {
  it('shows an honest on-by-default switch that turns suggestion feedback off and back on', () => {
    render(<StorageSection />);
    const toggle = screen.getByRole('switch', { name: 'Share suggestion feedback' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(toggle.getAttribute('aria-describedby')!)?.textContent).toMatch(
      /Never tied to your account or a deck/
    );

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(isSuggestionLabelsEnabled()).toBe(false);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(isSuggestionLabelsEnabled()).toBe(true);
  });
});
