// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LIFT_STRICT_FLOOR } from '@/deck-builder/services/edhrec/client';
import { ThinDataNote, THIN_SAMPLE_FLOOR, isThinSample } from './ThinDataNote';

describe('isThinSample', () => {
  it('tracks the lift pipeline’s strict floor, not a second number', () => {
    expect(THIN_SAMPLE_FLOOR).toBe(LIFT_STRICT_FLOOR);
  });

  it('is thin below the floor and fine at or above it', () => {
    expect(isThinSample(THIN_SAMPLE_FLOOR - 1)).toBe(true);
    expect(isThinSample(THIN_SAMPLE_FLOOR)).toBe(false);
    expect(isThinSample(40_000)).toBe(false);
  });

  it('treats absent data as absent, not as thin', () => {
    // 0 / null / undefined all mean "no evidence"; the surfaces render nothing
    // for those already, and claiming "based on only 0 decks" would be worse.
    expect(isThinSample(0)).toBe(false);
    expect(isThinSample(null)).toBe(false);
    expect(isThinSample(undefined)).toBe(false);
  });
});

describe('ThinDataNote', () => {
  it('states the exact sample size', () => {
    render(<ThinDataNote sampleSize={12} />);
    expect(
      screen.getByText('Based on only 12 decks on EDHREC — treat this as a hunch, not a stat.')
    ).toBeTruthy();
  });

  it('takes a caller-supplied noun and formats large-ish counts', () => {
    render(<ThinDataNote sampleSize={49} noun="decks pairing these cards" />);
    expect(screen.getByText(/49 decks pairing these cards/)).toBeTruthy();
  });

  it('renders nothing on a healthy sample, so it never displaces content', () => {
    const { container } = render(<ThinDataNote sampleSize={4321} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when there is no sample at all', () => {
    const { container } = render(<ThinDataNote sampleSize={null} />);
    expect(container.innerHTML).toBe('');
  });
});
