// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { focusArrivalHeading, scrollToHeading } from './scroll-to-heading';

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

  it('re-pins without stealing focus when focus is false', () => {
    document.body.innerHTML =
      '<h2 id="target-heading">Target</h2><input id="field" aria-label="Field" />';
    const el = document.getElementById('target-heading')!;
    const field = document.getElementById('field')!;
    field.focus();

    scrollToHeading('target-heading', { focus: false });

    expect(el.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
    expect(document.activeElement).toBe(field);
  });

  it('does not throw and does not move focus when the id does not exist', () => {
    expect(() => scrollToHeading('missing-id')).not.toThrow();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBeInstanceOf(HTMLHeadingElement);
  });
});

describe('focusArrivalHeading', () => {
  it('focuses the page heading on arrival', () => {
    document.body.innerHTML = '<main><h1>Decks</h1><button>New deck</button></main>';
    const main = document.querySelector('main')!;

    expect(focusArrivalHeading(main)).toBe(true);

    const heading = main.querySelector('h1')!;
    expect(document.activeElement).toBe(heading);
    expect(heading.tabIndex).toBe(-1);
    expect(heading.classList.contains('scroll-heading-target')).toBe(true);
  });

  it('reports a miss while the heading has not painted yet', () => {
    document.body.innerHTML = '<main></main>';
    expect(focusArrivalHeading(document.querySelector('main')!)).toBe(false);
  });

  // Card search autofocuses its box on desktop; the shell's arrival focus ran
  // after it and moved the caret to the <h1>, so in-app navigation to /search
  // never landed in the field.
  it('leaves focus in a field the page already focused', () => {
    document.body.innerHTML =
      '<main><h1>Card search</h1><input aria-label="Search any card" /></main>';
    const main = document.querySelector('main')!;
    const input = main.querySelector('input')!;
    input.focus();

    expect(focusArrivalHeading(main)).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it('still takes focus from a field outside the page (the header)', () => {
    document.body.innerHTML =
      '<header><input aria-label="Header search" /></header><main><h1>Decks</h1></main>';
    const main = document.querySelector('main')!;
    document.querySelector('input')!.focus();

    focusArrivalHeading(main);
    expect(document.activeElement).toBe(main.querySelector('h1'));
  });
});
