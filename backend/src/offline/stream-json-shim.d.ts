/**
 * Ambient module declaration for stream-json's kebab-case subpath imports.
 *
 * stream-json v2's package.json maps `"./*": "./src/*"` via the `exports`
 * field, which Node honors at runtime but TypeScript's classic CJS module
 * resolution (`"module": "commonjs"`) does not. The package's own types live
 * at `./src/streamers/stream-array.d.ts` but the importable specifier is
 * `stream-json/streamers/stream-array` — TS can't bridge that without
 * `moduleResolution: "node16"`, which would be a bigger config change than
 * this single import warrants.
 *
 * Re-exports the runtime shape we use. Mirrors the upstream `.d.ts` minimally.
 */
declare module 'stream-json/streamers/stream-array.js' {
  import { Duplex } from 'node:stream';

  interface StreamArrayItem<T = unknown> {
    key: number;
    value: T;
  }

  interface StreamArrayFactory {
    (options?: Record<string, unknown>): (chunk: unknown) => StreamArrayItem | symbol;
    asStream(options?: Record<string, unknown>): Duplex;
    withParser(options?: Record<string, unknown>): (chunk: string) => unknown;
    withParserAsStream(options?: Record<string, unknown>): Duplex;
    streamArray: StreamArrayFactory;
  }

  const streamArray: StreamArrayFactory;
  export default streamArray;
}
