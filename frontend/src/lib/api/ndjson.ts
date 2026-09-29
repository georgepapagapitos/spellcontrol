/**
 * Reader for the AI routes' NDJSON wire format (T102) — one JSON object per
 * line, streamed as the model writes. Shared by the deck review and the
 * post-generation refine pass so there is one place that knows how to chunk,
 * buffer and parse it.
 *
 * The caller owns the meaning of the lines; this only guarantees each parsed
 * object arrives once, in order.
 */
export type NdjsonLine = { delta?: unknown; done?: unknown; error?: unknown };

/**
 * Read the whole body, handing each parsed line to `onLine`.
 *
 * A frame that doesn't parse means the rest of the stream can't be trusted
 * either, so it throws readable copy rather than letting a raw `SyntaxError`
 * reach the UI as an error message.
 */
export async function readNdjson(res: Response, onLine: (line: NdjsonLine) => void): Promise<void> {
  const handle = (raw: string) => {
    if (!raw.trim()) return;
    let parsed: NdjsonLine;
    try {
      parsed = JSON.parse(raw) as NdjsonLine;
    } catch {
      throw new Error('The response came back garbled. Try again.');
    }
    onLine(parsed);
  };

  if (!res.body) {
    // No readable stream (a test double, or a runtime without one): same
    // NDJSON, it just arrives all at once.
    for (const line of (await res.text()).split('\n')) handle(line);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      handle(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');
    }
  }
  handle(buffer);
}
