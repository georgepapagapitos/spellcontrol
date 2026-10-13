/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guard for the deck-size prompt ("Deck is full"): its one scroll body holds
// the AI verdict, the ranked rows and the empty line. The .card-picker shell
// pads only its header and footer, so the body must carry its own inset. When
// it didn't, everything between header and footer ran flush to the sheet's
// edges (user report, 2026-10-13). The inline inset must match the header's,
// so the rows line up with the title and the footer buttons.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

describe('deck-size prompt body inset', () => {
  const css = readFileSync(join(srcRoot, 'components', 'deck', 'DeckSizePrompt.css'), 'utf8');
  const shell = readFileSync(join(srcRoot, 'styles', 'binder-card-management.css'), 'utf8');
  const body = block(css, '.deck-size-prompt-body');

  it('pads the body with the same inline inset as the shell header', () => {
    const header = block(shell, '.card-picker-header');
    const headerInline = /padding:\s*\S+\s+(var\(--space-[\d-]+\))/.exec(header)?.[1];
    expect(headerInline).toBeDefined();
    const bodyInline = /padding:\s*\S+\s+(var\(--space-[\d-]+\))/.exec(body)?.[1];
    expect(bodyInline).toBe(headerInline);
  });

  it('spaces its sections with a token gap, not child margins', () => {
    expect(body).toMatch(/gap:\s*var\(--space-[\d-]+\)/);
    expect(block(css, '.deck-size-prompt-empty')).not.toMatch(/margin:(?!\s*0;)/);
    expect(block(css, '.deck-size-prompt-ai')).toBe('');
  });
});
