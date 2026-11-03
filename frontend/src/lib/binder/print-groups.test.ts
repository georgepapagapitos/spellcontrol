/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { groupPrintRows, printFinishLabel } from './print-groups';

const bolt = { name: 'Lightning Bolt', setCode: 'm11', collectorNumber: '149' };

describe('groupPrintRows', () => {
  it('keeps a foil and a nonfoil of one printing as separate rows with distinct keys', () => {
    const rows = groupPrintRows([
      { ...bolt, finish: 'nonfoil' },
      { ...bolt, finish: 'foil' },
    ]);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    expect(rows.map((r) => r.finish).sort()).toEqual(['foil', 'nonfoil']);
  });

  it('rolls duplicate copies of the same printing and finish into a quantity', () => {
    const rows = groupPrintRows([
      { ...bolt, finish: 'foil' },
      { ...bolt, finish: 'foil' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].qty).toBe(2);
  });
});

describe('printFinishLabel', () => {
  it('marks foil and etched, leaves nonfoil unmarked', () => {
    expect(printFinishLabel('foil')).toBe('Foil');
    expect(printFinishLabel('etched')).toBe('Etched');
    expect(printFinishLabel('nonfoil')).toBeNull();
  });
});

describe('BinderPage print list (CB-01)', () => {
  // The defect: the <li> key was name|set|number with no finish, so a foil and
  // a nonfoil of one printing collided. The row key now comes from groupPrintRows.
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../../pages/BinderPage.tsx'), 'utf8');

  it('keys each print row by the finish-aware row key', () => {
    expect(page).toContain('<li key={row.key}>');
    expect(page).not.toMatch(
      /key=\{`\$\{row\.name\}\|\$\{row\.setCode\}\|\$\{row\.collectorNumber\}`\}/
    );
  });

  it('prints the finish label beside the printing', () => {
    expect(page).toContain('printFinishLabel(row.finish)');
  });
});
