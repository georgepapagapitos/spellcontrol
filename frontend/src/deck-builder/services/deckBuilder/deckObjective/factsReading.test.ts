// @vitest-environment node
//
// The objective reads a card's facts against its own text (factsReading.ts).
// Every card here stated a false reason in the first optimizer gate.
import { describe, expect, it } from 'vitest';
import {
  commanderMustSurvive,
  isSurvivalPiece,
  protectsOnlyItself,
  protectsOthers,
  tokensGoToOthers,
} from './factsReading';
import { card, merenCtx } from './__fixtures__/objectiveFixture';

const ctx = merenCtx();
const facts = (name: string) => ctx.factsOf(card(name));

describe('facts the text bears out', () => {
  it('reads a transforming card as its front face: Elesh Norn is not a board wipe', () => {
    const norn = facts('Elesh Norn // The Argent Etchings');
    expect(norn.interaction.filter((f) => f.scope === 'mass')).toEqual([]);
  });

  it('counts protection only when it protects something besides the card itself', () => {
    const kaito = card('Kaito Shizuki');
    expect(protectsOnlyItself(kaito)).toBe(true);
    expect(facts('Kaito Shizuki').roles.some((r) => r.role === 'protection')).toBe(false);
    for (const name of ['Lightning Greaves', "Teferi's Protection", 'Selfless Safewright']) {
      expect(protectsOthers(card(name)), name).toBe(true);
      expect(
        facts(name).roles.some((r) => r.role === 'protection'),
        name
      ).toBe(true);
    }
    // A redirect has no protection words at all, and keeps its fact.
    expect(protectsOnlyItself(card('Deflecting Swat'))).toBe(false);
  });

  it("drops a token that goes to another player: Rapid Hybridization's Frog Lizard", () => {
    expect(tokensGoToOthers(card('Rapid Hybridization'))).toBe(true);
    expect(facts('Rapid Hybridization').produces.some((p) => p.r === 'creature-token')).toBe(false);
    expect(tokensGoToOthers(card('Siege-Gang Commander'))).toBe(false);
  });

  it("needs the resource in a payoff card's text", () => {
    // Convoke is not a token payoff; casting planeswalkers is not loyalty.
    expect(facts('Selfless Safewright').payoffs.some((p) => p.r === 'creature-token')).toBe(false);
    expect(facts('Interplanar Beacon').payoffs.some((p) => p.r === 'loyalty')).toBe(false);
    // A creature entering is: Impact Tremors pays off every Goblin token.
    expect(facts('Impact Tremors').payoffs.some((p) => p.r === 'creature-token')).toBe(true);
  });

  it('knows a commander that has to survive or connect', () => {
    expect(commanderMustSurvive([card('Krenko, Mob Boss')])).toBe(true);
    expect(commanderMustSurvive([card('Meren of Clan Nel Toth')])).toBe(true);
    expect(commanderMustSurvive([card('Talrand, Sky Summoner')])).toBe(true);
    expect(commanderMustSurvive([])).toBe(false);
    expect(isSurvivalPiece(card('Lightning Greaves'), facts('Lightning Greaves'))).toBe(true);
    expect(isSurvivalPiece(card('Deflecting Swat'), facts('Deflecting Swat'))).toBe(false);
  });
});
