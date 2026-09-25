// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BracketVerdictStrip } from './BracketVerdictStrip';

describe('BracketVerdictStrip', () => {
  it('renders nothing when neither a bracket nor an estimate exists', () => {
    const { container } = render(<BracketVerdictStrip />);
    expect(container.firstChild).toBeNull();
  });

  it('reads "Auto" for the bracket figure when none is stated', () => {
    render(<BracketVerdictStrip estimate={3} />);
    expect(screen.getAllByText('Auto').length).toBeGreaterThan(0);
    expect(screen.getByText('B3')).toBeTruthy();
  });

  it('shows "No estimate" when a bracket is stated but nothing has been estimated yet', () => {
    render(<BracketVerdictStrip bracket={3} />);
    expect(screen.getByText('No estimate')).toBeTruthy();
  });

  it('reads "Matches" when the estimate equals the stated bracket', () => {
    render(<BracketVerdictStrip bracket={3} estimate={3} />);
    expect(screen.getByText('Matches')).toBeTruthy();
    expect(screen.getByText('The list plays at the bracket you set.')).toBeTruthy();
  });

  it('reads "Plays above" and points at the Coach Bracket lane when the estimate is hotter', () => {
    render(<BracketVerdictStrip bracket={2} estimate={4} />);
    expect(screen.getByText('Plays above')).toBeTruthy();
    expect(screen.getByText(/Coach tab's Bracket lane to bring it down/)).toBeTruthy();
  });

  it('reads "Plays below" and points at the Coach Bracket lane when the estimate is softer', () => {
    render(<BracketVerdictStrip bracket={4} estimate={2} />);
    expect(screen.getByText('Plays below')).toBeTruthy();
    expect(screen.getByText(/Coach tab's Bracket lane to bring it up/)).toBeTruthy();
  });

  it('Bracket 1 at the Core floor reads as Exhibition, not "above"', () => {
    render(<BracketVerdictStrip bracket={1} estimate={2} />);
    expect(screen.getByText('Exhibition')).toBeTruthy();
    expect(screen.queryByText('Plays above')).toBeNull();
    expect(screen.getByText(/estimate at Core \(2\) or higher/)).toBeTruthy();
  });

  it('Bracket 1 with an estimate of 3+ reads as "Plays above" toward the Core floor', () => {
    render(<BracketVerdictStrip bracket={1} estimate={4} />);
    expect(screen.getByText('Plays above')).toBeTruthy();
    expect(screen.getByText(/cuts toward the Core floor/)).toBeTruthy();
  });
});

// An estimate made before the combo match answered is a floor. "Plays below"
// off it once told an owner to add power to a deck that was really above.
describe('BracketVerdictStrip with a floor estimate', () => {
  it('reads the estimate as B2+ and holds the verdict when the floor is under the stated bracket', () => {
    render(<BracketVerdictStrip bracket={3} estimate={2} estimateIsFloor />);
    expect(screen.getByText('B2+')).toBeTruthy();
    expect(screen.getByText('Unconfirmed')).toBeTruthy();
    expect(screen.queryByText('Plays below')).toBeNull();
  });

  it('does not call a floor that equals the stated bracket a match', () => {
    render(<BracketVerdictStrip bracket={3} estimate={3} estimateIsFloor />);
    expect(screen.getByText('Unconfirmed')).toBeTruthy();
    expect(screen.queryByText('Matches')).toBeNull();
  });

  it('still says "Plays above" when the floor alone clears the stated bracket', () => {
    render(<BracketVerdictStrip bracket={2} estimate={3} estimateIsFloor />);
    expect(screen.getByText('B3+')).toBeTruthy();
    expect(screen.getByText('Plays above')).toBeTruthy();
  });

  it('holds the Bracket 1 verdict too: a Core floor may still play above Exhibition', () => {
    render(<BracketVerdictStrip bracket={1} estimate={2} estimateIsFloor />);
    expect(screen.getByText('Unconfirmed')).toBeTruthy();
  });
});
