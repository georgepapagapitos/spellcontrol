import { describe, expect, it } from 'vitest';
import type { PublicDeck } from './projections';
import type { PublicDeckSummary } from '../publications/cache';
import { buildDeckLandingBody, buildProfileLandingBody } from './landing-body';

const card = (name: string, type_line: string) => ({ card: { name, type_line } });

function deck(overrides: Partial<PublicDeck> = {}): PublicDeck {
  return {
    ownerUsername: 'brewer',
    ownerDisplayName: 'The Brewer',
    id: 'd1',
    name: 'Elves <go>',
    format: 'commander',
    commander: { name: 'Lathril, Blade of the Elves', type_line: 'Legendary Creature — Elf' },
    partnerCommander: null,
    cards: [],
    sideboard: [],
    color: '#888',
    ...overrides,
  };
}

describe('buildDeckLandingBody', () => {
  it('lists the deck by type group, counting copies, with the author linked', () => {
    const html = buildDeckLandingBody({
      deck: deck({
        cards: [
          card('Llanowar Elves', 'Creature — Elf Druid'),
          card('Forest', 'Basic Land — Forest'),
          card('Forest', 'Basic Land — Forest'),
          card('Sol Ring', 'Artifact'),
          card('Dryad Arbor', 'Land Creature — Forest Dryad'),
          card('Bala Ged Recovery // Bala Ged Sanctuary', 'Sorcery // Land'),
        ],
      }),
    });
    expect(html).toContain('<h1>Elves &lt;go&gt;</h1>');
    expect(html).toContain('led by Lathril, Blade of the Elves');
    expect(html).toContain('<a href="/u/brewer">The Brewer</a>');
    expect(html).toContain('<h2>Creatures (2)</h2>');
    expect(html).toContain('<li>1 Dryad Arbor</li>');
    expect(html).toContain('<h2>Lands (2)</h2><ul><li>2 Forest</li></ul>');
    // A modal double-faced card files under its front face.
    expect(html).toContain('<h2>Sorceries (1)</h2>');
    // Groups follow the deck page's order.
    expect(html.indexOf('Creatures')).toBeLessThan(html.indexOf('Sorceries'));
    expect(html.indexOf('Artifacts')).toBeLessThan(html.indexOf('Lands'));
  });

  it('is visually hidden, so the app layout never flashes a plain list first', () => {
    expect(buildDeckLandingBody({ deck: deck() })).toMatch(/^<main style="position:absolute;/);
  });

  it('escapes every user-written string', () => {
    const html = buildDeckLandingBody({
      deck: deck({
        name: '<script>x</script>',
        ownerUsername: 'a"b',
        ownerDisplayName: '<b>',
        primer: '<img src=x onerror=1>',
        commander: null,
        cards: [card('<i>', 'Creature')],
      }),
    });
    // Remove the tags the builder emits itself; any `<` left came from user text.
    const ownTags = /<\/?(?:main|h1|h2|p|ul|li|a)(?:\s[^>]*)?>/g;
    expect(html.replace(ownTags, '')).not.toContain('<');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('href="/u/a&quot;b"');
  });

  it('omits the commander section for a deck without one', () => {
    const html = buildDeckLandingBody({ deck: deck({ commander: null, format: 'modern' }) });
    expect(html).toContain('<p>A modern deck, by');
    expect(html).not.toContain('Commander</h2>');
  });
});

describe('buildProfileLandingBody', () => {
  const summary = (slug: string, name: string, commanderName: string | null) =>
    ({ slug, name, format: 'commander', commanderName }) as PublicDeckSummary;

  it('links every public deck', () => {
    const html = buildProfileLandingBody({
      username: 'brewer',
      displayName: null,
      bio: 'Elves & more',
      decks: [summary('elves-1', 'Elves', 'Lathril'), summary('pile-2', 'Pile', null)],
    });
    expect(html).toContain('<h1>brewer</h1>');
    expect(html).toContain('<p>Elves &amp; more</p>');
    expect(html).toContain('<a href="/d/elves-1">Elves</a>, commander deck led by Lathril');
    expect(html).toContain('<a href="/d/pile-2">Pile</a>, commander deck</li>');
  });
});
