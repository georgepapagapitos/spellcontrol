// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotFoundPage } from './NotFoundPage';
import { NotFoundView } from '@/components/share/SharedShell';

describe('not-found headings', () => {
  it('carry no trailing period, matching the shared not-found view', () => {
    const { unmount } = render(
      <MemoryRouter>
        <NotFoundPage homePath="/collection" />
      </MemoryRouter>
    );
    const page = screen.getByRole('heading', { level: 1 }).textContent ?? '';
    unmount();
    render(
      <MemoryRouter>
        <NotFoundView title="Profile not found" />
      </MemoryRouter>
    );
    const shared = screen.getByRole('heading', { level: 1 }).textContent ?? '';
    expect(page.endsWith('.')).toBe(false);
    expect(shared.endsWith('.')).toBe(false);
  });
});
