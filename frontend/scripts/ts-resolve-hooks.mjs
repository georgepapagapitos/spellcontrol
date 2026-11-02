// Node resolve hook: lets a script import `src/**/*.ts` modules that use the
// app's extensionless relative imports ('./info-glyphs'). Node 22 strips the
// types itself; it just needs the extension filled in.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
    const base = new URL(specifier, context.parentURL);
    const ts = base.href + '.ts';
    if (existsSync(fileURLToPath(ts))) return nextResolve(ts, context);
  }
  return nextResolve(specifier, context);
}
