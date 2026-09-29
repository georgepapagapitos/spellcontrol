// @vitest-environment happy-dom
/**
 * B6-15: solo play has nobody to ask for a takeback — `resolveTakebackPlan`
 * (lib/takeback.ts) already applies an 'ask' verdict immediately when
 * `!online` ("nobody to ask"), but the picker used to describe "Ask" as
 * needing everyone's OK regardless. It should say what actually happens.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TakebackModePicker } from './TakebackModePicker';

describe('TakebackModePicker — online/offline description', () => {
  it('describes Ask as immediate when solo (no table to ask)', () => {
    render(<TakebackModePicker mode="ask" onSelect={() => {}} onClose={() => {}} online={false} />);
    expect(screen.getByText(/nobody to ask, so this acts like Free/)).toBeTruthy();
    expect(screen.queryByText(/need everyone's OK/)).toBeNull();
  });

  it("describes Ask as needing the table's OK when online", () => {
    render(<TakebackModePicker mode="ask" onSelect={() => {}} onClose={() => {}} online />);
    expect(screen.getByText(/need everyone's OK/)).toBeTruthy();
  });
});
