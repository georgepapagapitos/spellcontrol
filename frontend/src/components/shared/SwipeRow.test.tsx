// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SwipeRow } from './SwipeRow';

describe('SwipeRow', () => {
  it("is the list itself, carrying its own classes and the row's hook", () => {
    const { container } = render(
      <SwipeRow className="decks-index-list is-grid" aria-label="Your decks">
        <li>One</li>
        <li>Two</li>
      </SwipeRow>
    );
    const ul = container.firstElementChild as HTMLElement;
    expect(ul.tagName).toBe('UL');
    expect(ul.className).toBe('swipe-row decks-index-list is-grid');
    expect(ul.hasAttribute('data-swipe-row')).toBe(true);
    expect(ul.getAttribute('aria-label')).toBe('Your decks');
    expect(ul.children).toHaveLength(2);
  });

  it('sets the desktop column count, five by default', () => {
    const { container } = render(
      <>
        <SwipeRow className="a" />
        <SwipeRow className="b" columns={6} />
      </>
    );
    const [five, six] = [...container.children] as HTMLElement[];
    expect(five.style.getPropertyValue('--swipe-columns')).toBe('5');
    expect(six.style.getPropertyValue('--swipe-columns')).toBe('6');
  });
});
