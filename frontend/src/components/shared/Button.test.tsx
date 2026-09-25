// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { Button, IconButton } from './Button';

describe('Button', () => {
  it.each([
    [{}, 'btn'],
    [{ variant: 'primary' }, 'btn btn-primary'],
    [{ variant: 'danger' }, 'btn btn-danger'],
    [{ variant: 'link' }, 'btn-link'],
    [{ placement: 'row' }, 'pill-btn'],
    [{ placement: 'row', variant: 'primary' }, 'pill-btn pill-btn-primary'],
    [{ placement: 'row', variant: 'danger' }, 'pill-btn pill-btn-danger'],
    [{ placement: 'toolbar' }, 'toolbar-pill'],
  ] as const)('%o renders the existing classes %s', (look, cls) => {
    render(<Button {...look}>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' }).className).toBe(cls);
  });

  it('appends a surface modifier after the variant classes', () => {
    render(
      <Button variant="primary" className="shared-copy-btn">
        Copy
      </Button>
    );
    expect(screen.getByRole('button').className).toBe('btn btn-primary shared-copy-btn');
  });

  it('puts the label in its own element and hides the icons', () => {
    render(
      <Button icon={<Plus />} iconEnd={<X />}>
        Add cards
      </Button>
    );
    const btn = screen.getByRole('button', { name: 'Add cards' });
    const [lead, label, trail] = Array.from(btn.children);
    expect(lead.tagName.toLowerCase()).toBe('svg');
    expect(lead.getAttribute('aria-hidden')).toBe('true');
    expect(label.className).toBe('btn-label');
    expect(label.textContent).toBe('Add cards');
    expect(trail.getAttribute('aria-hidden')).toBe('true');
  });

  it('skips an icon slot given nothing', () => {
    render(<Button icon={false}>Plain</Button>);
    expect(screen.getByRole('button').children).toHaveLength(1);
  });

  it('is type=button by default, so it never submits a form by accident', () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Cancel</Button>
        <Button type="submit" variant="primary">
          Send
        </Button>
      </form>
    );
    expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('type')).toBe('button');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('passes native attributes and the ref through', () => {
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} disabled aria-label="Download as text file" onClick={onClick}>
        Download
      </Button>
    );
    const btn = screen.getByRole('button', { name: 'Download as text file' });
    expect(ref.current).toBe(btn);
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders a router Link for `to`', () => {
    render(
      <MemoryRouter>
        <Button to="/decks" variant="primary">
          Your decks
        </Button>
      </MemoryRouter>
    );
    const link = screen.getByRole('link', { name: 'Your decks' });
    expect(link.getAttribute('href')).toBe('/decks');
    expect(link.className).toBe('btn btn-primary');
    expect(link.hasAttribute('type')).toBe(false);
  });

  it('renders a plain anchor for `href`', () => {
    render(
      <Button href="https://scryfall.com" target="_blank" rel="noreferrer">
        Scryfall
      </Button>
    );
    const link = screen.getByRole('link', { name: 'Scryfall' });
    expect(link.getAttribute('href')).toBe('https://scryfall.com');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});

// Combinations no stylesheet defines must not compile (checked by `tsc -b`).
export const typeGuards = [
  // @ts-expect-error `.pill-btn` has no link variant
  <Button key="a" placement="row" variant="link">
    x
  </Button>,
  // @ts-expect-error `.toolbar-pill` has no primary variant
  <Button key="b" placement="toolbar" variant="primary">
    x
  </Button>,
  // @ts-expect-error a link cannot be disabled
  <Button key="c" to="/decks" disabled>
    x
  </Button>,
  // @ts-expect-error an icon button needs a name
  <IconButton key="d" icon={<X />} />,
];

describe('IconButton', () => {
  it('is named by its label, which is also the tooltip, and hides the glyph', () => {
    render(<IconButton label="Close" icon={<X />} className="modal-close" />);
    const btn = screen.getByRole('button', { name: 'Close' });
    expect(btn.getAttribute('title')).toBe('Close');
    expect(btn.className).toBe('modal-close');
    expect(btn.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(btn.textContent).toBe('');
  });

  it('takes a different tooltip, or none', () => {
    const { rerender } = render(<IconButton label="Close" title="Close (Esc)" icon={<X />} />);
    expect(screen.getByRole('button').getAttribute('title')).toBe('Close (Esc)');
    rerender(<IconButton label="Close" title={false} icon={<X />} />);
    expect(screen.getByRole('button').hasAttribute('title')).toBe(false);
  });

  it('adds the shared classes only when asked for a look', () => {
    render(<IconButton label="Delete" icon={<X />} variant="danger" />);
    expect(screen.getByRole('button', { name: 'Delete' }).className).toBe('btn btn-danger');
  });
});
