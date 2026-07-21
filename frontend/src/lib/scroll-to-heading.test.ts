// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { scrollToHeading } from './scroll-to-heading';

beforeAll(() => {
  // happy-dom doesn't implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.mocked(Element.prototype.scrollIntoView).mockClear();
});

describe('scrollToHeading', () => {
  it('scrolls the target into view and focuses it', () => {
    document.body.innerHTML = '<h2 id="target-heading">Target</h2>';
    const el = document.getElementById('target-heading')!;

    scrollToHeading('target-heading');

    expect(el.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
    expect(el.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(el);
  });

  it('does not throw and does not move focus when the id does not exist', () => {
    expect(() => scrollToHeading('missing-id')).not.toThrow();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBeInstanceOf(HTMLHeadingElement);
  });
});
