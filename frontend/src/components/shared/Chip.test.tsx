// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Plus } from 'lucide-react';
import { Chip } from './Chip';

describe('Chip', () => {
  it('with no handler is a label: a span with the label in its own element', () => {
    const { container } = render(<Chip className="verdict-chip is-success">Pass</Chip>);
    const chip = container.firstElementChild!;
    expect(chip.tagName).toBe('SPAN');
    expect(chip.className).toBe('verdict-chip is-success');
    expect(chip.children[0].className).toBe('chip-label');
    expect(chip.textContent).toBe('Pass');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders as a list item when asked', () => {
    const { container } = render(
      <ul>
        <Chip as="li" className="bracket-breakdown-chip">
          Two-card combo
        </Chip>
      </ul>
    );
    expect(container.querySelector('li.bracket-breakdown-chip')).not.toBeNull();
  });

  it('with pressed is a toggle button that reports its state', () => {
    const onClick = vi.fn();
    render(
      <Chip className="coach-feed-filter-chip" pressed onClick={onClick}>
        Adds
      </Chip>
    );
    const chip = screen.getByRole('button', { name: 'Adds' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(chip.getAttribute('type')).toBe('button');
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('with onClick alone is an action button with no pressed state', () => {
    render(
      <Chip className="deck-tokens-chip" onClick={() => {}}>
        Tokens
      </Chip>
    );
    expect(screen.getByRole('button', { name: 'Tokens' }).hasAttribute('aria-pressed')).toBe(false);
  });

  it('keeps a count badge and an icon as their own elements beside the label', () => {
    const { container } = render(
      <Chip
        className="coach-feed-filter-chip"
        pressed={false}
        onClick={() => {}}
        icon={<Plus />}
        trailing={<span className="coach-feed-chip-count">3</span>}
      >
        Adds
      </Chip>
    );
    const [icon, label, count] = Array.from(container.querySelector('button')!.children);
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(label.className).toBe('chip-label');
    expect(label.textContent).toBe('Adds');
    expect(count.className).toBe('coach-feed-chip-count');
  });

  it('removable: the × is a sibling button with its own name, not nested in the label', () => {
    const onRemove = vi.fn();
    const { container } = render(
      <Chip
        className="collection-filter-chip"
        labelClassName="collection-filter-chip-label"
        onRemove={onRemove}
        removeLabel="Remove filter: Red"
        removeClassName="collection-filter-chip-clear"
      >
        Red
      </Chip>
    );
    const chip = container.firstElementChild!;
    expect(chip.tagName).toBe('SPAN');
    expect(chip.children[0].className).toBe('chip-label collection-filter-chip-label');
    const x = screen.getByRole('button', { name: 'Remove filter: Red' });
    expect(x.parentElement).toBe(chip);
    expect(x.className).toBe('collection-filter-chip-clear');
    fireEvent.click(x);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
