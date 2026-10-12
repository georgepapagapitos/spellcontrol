// @vitest-environment happy-dom
/**
 * The public binder (/b/:slug) and list (/l/:slug) pages: every state the
 * visitor can land in, and that each kind renders its own view.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/lib/social/share-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/social/share-client')>();
  return { ...real, fetchPublicResourcePage: fetchMock };
});
vi.mock('../components/share/SharedBinderView', () => ({
  SharedBinderView: ({ data }: { data: { name: string } }) => <div>binder view {data.name}</div>,
}));
vi.mock('../components/share/SharedListView', () => ({
  SharedListView: ({ data }: { data: { name: string } }) => <div>list view {data.name}</div>,
}));

import { ShareNotFoundError } from '@/lib/social/share-client';
import { PublicBinderPage, PublicListPage } from './PublicResourcePage';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/b/:slug" element={<PublicBinderPage />} />
        <Route path="/l/:slug" element={<PublicListPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('PublicResourcePage', () => {
  it('shows a busy loading state, then the binder', async () => {
    fetchMock.mockResolvedValue({ kind: 'binder', slug: 's', data: { name: 'Artifacts' } });
    const { container } = renderAt('/b/artifacts-1234abcd');
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(await screen.findByText('binder view Artifacts')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('binder', 'artifacts-1234abcd');
    expect(document.title).toContain('Artifacts');
  });

  it('renders a list on the list route', async () => {
    fetchMock.mockResolvedValue({ kind: 'list', slug: 's', data: { name: 'Wantlist' } });
    renderAt('/l/wantlist-1234abcd');
    expect(await screen.findByText('list view Wantlist')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('list', 'wantlist-1234abcd');
  });

  it('answers a private, removed or unknown page with one not-found view', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new ShareNotFoundError()));
    renderAt('/b/nope-00000000');
    await screen.findByText(/private, was removed/);
    expect(screen.getByText(/private, was removed, or the address is wrong/)).toBeTruthy();
    expect(screen.getByText('Go to SpellControl').closest('a')?.getAttribute('href')).toBe('/');
    expect(document.title).toContain('Page not found');
  });

  it('offers a retry after a network failure, and recovers', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    fetchMock.mockResolvedValue({ kind: 'binder', slug: 's', data: { name: 'Artifacts' } });
    renderAt('/b/artifacts-1234abcd');
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('binder view Artifacts')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
