// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MeterBar, StackedBar, meterPct, stackedTrackPcts } from './MeterBar';

describe('meterPct', () => {
  it('maps value/max to a percentage', () => {
    expect(meterPct(25, 100)).toBe(25);
    expect(meterPct(3, 12)).toBe(25);
  });

  it('clamps overflow to 100 and negatives to 0', () => {
    expect(meterPct(150, 100)).toBe(100);
    expect(meterPct(-5, 100)).toBe(0);
  });

  it('reads degenerate scales as empty, never NaN', () => {
    expect(meterPct(5, 0)).toBe(0);
    expect(meterPct(5, -1)).toBe(0);
    expect(meterPct(NaN, 100)).toBe(0);
    expect(meterPct(5, NaN)).toBe(0);
  });
});

describe('stackedTrackPcts', () => {
  it('fills the track proportionally when no max is given', () => {
    expect(stackedTrackPcts([{ value: 3 }, { value: 1 }])).toEqual([75, 25]);
  });

  it('spans sum/max of the track when max exceeds the sum', () => {
    // 30 cards out of a 100-card scale → the stack occupies 30% of the track.
    expect(stackedTrackPcts([{ value: 20 }, { value: 10 }], 100)).toEqual([20, 10]);
  });

  it('renormalizes on overflow (sum > max) instead of clipping', () => {
    const pcts = stackedTrackPcts([{ value: 150 }, { value: 50 }], 100);
    expect(pcts).toEqual([75, 25]);
  });

  it('treats negative / non-finite values as 0 and an all-zero stack as empty', () => {
    expect(stackedTrackPcts([{ value: -4 }, { value: 4 }])).toEqual([0, 100]);
    expect(stackedTrackPcts([{ value: NaN }, { value: 4 }])).toEqual([0, 100]);
    expect(stackedTrackPcts([{ value: 0 }, { value: 0 }])).toEqual([0, 0]);
  });
});

describe('MeterBar', () => {
  it('renders an aria-hidden track with a proportional fill by default', () => {
    const { container } = render(<MeterBar value={30} max={120} />);
    const track = container.querySelector('.meterbar') as HTMLElement;
    expect(track.getAttribute('aria-hidden')).toBe('true');
    const fill = track.querySelector('.meterbar-fill') as HTMLElement;
    expect(fill.style.width).toBe('25%');
  });

  it('applies the caller palette and clamps overflow', () => {
    const { container } = render(<MeterBar value={500} max={100} color="var(--warn-text)" />);
    const fill = container.querySelector('.meterbar-fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
    expect(fill.style.background).toContain('--warn-text');
  });

  it('exposes meter semantics only when a role is opted into', () => {
    const { container } = render(<MeterBar value={4} max={10} role="meter" label="Readiness" />);
    const track = container.querySelector('.meterbar') as HTMLElement;
    expect(track.getAttribute('role')).toBe('meter');
    expect(track.getAttribute('aria-valuenow')).toBe('4');
    expect(track.getAttribute('aria-valuemax')).toBe('10');
    expect(track.getAttribute('aria-label')).toBe('Readiness');
  });

  it('floors the visual fill via minPct while aria-valuenow stays truthful', () => {
    const { container } = render(<MeterBar value={0} max={100} minPct={2} role="progressbar" />);
    const track = container.querySelector('.meterbar') as HTMLElement;
    const fill = track.querySelector('.meterbar-fill') as HTMLElement;
    expect(fill.style.width).toBe('2%');
    expect(track.getAttribute('aria-valuenow')).toBe('0');
  });

  it('renders the indeterminate sweep without a fixed width or valuenow', () => {
    const { container } = render(<MeterBar value={0} indeterminate role="progressbar" />);
    const track = container.querySelector('.meterbar') as HTMLElement;
    const fill = track.querySelector('.meterbar-fill') as HTMLElement;
    expect(fill.classList.contains('meterbar-fill--indeterminate')).toBe(true);
    expect(fill.style.width).toBe('');
    expect(track.getAttribute('aria-valuenow')).toBeNull();
  });

  it('supports the md (progress) size', () => {
    const { container } = render(<MeterBar value={1} size="md" />);
    expect(container.querySelector('.meterbar--md')).not.toBeNull();
  });
});

describe('StackedBar', () => {
  const segments = [
    { key: 'a', value: 6, color: 'red', title: 'Red: 6' },
    { key: 'b', value: 0, color: 'blue' },
    { key: 'c', value: 2, color: 'green' },
  ];

  it('sizes the stack to sum/max and the segments to their share of the stack', () => {
    const { container } = render(<StackedBar segments={segments} max={16} />);
    const stack = container.querySelector('.meterbar-segments') as HTMLElement;
    // 8 of 16 → the stack spans half the track.
    expect(stack.style.width).toBe('50%');
    const segs = Array.from(stack.querySelectorAll('.meterbar-seg')) as HTMLElement[];
    // The zero-value segment is skipped entirely.
    expect(segs.length).toBe(2);
    expect(segs[0].style.width).toBe('75%');
    expect(segs[1].style.width).toBe('25%');
    expect(segs[0].title).toBe('Red: 6');
  });

  it('fills the whole track when no max is given', () => {
    const { container } = render(<StackedBar segments={segments} />);
    const stack = container.querySelector('.meterbar-segments') as HTMLElement;
    expect(stack.style.width).toBe('100%');
  });

  it('renders an empty aria-hidden track when every segment is zero', () => {
    const { container } = render(<StackedBar segments={[{ key: 'a', value: 0, color: 'red' }]} />);
    const track = container.querySelector('.meterbar') as HTMLElement;
    expect(track.getAttribute('aria-hidden')).toBe('true');
    expect(track.querySelector('.meterbar-segments')).toBeNull();
  });
});
