const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(raw: string): string {
  return raw.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

/** Bold before italic so a `**x**` pair isn't half-eaten by the italic pass.
 *  Both regexes are non-greedy and require a real closing pair, so an odd
 *  number of `*`/`**` markers just leaves the trailing marker(s) as literal
 *  text — nothing throws and nothing downstream gets consumed. */
function renderInline(html: string): string {
  return html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
}

/**
 * Minimal, dependency-free, XSS-safe markdown subset for the deck primer:
 * `**bold**`, `*italic*`, blank-line-separated paragraphs, and `- ` bullet
 * lists. Escape-then-transform by construction — the whole input is
 * HTML-entity-escaped FIRST, then every subsequent regex runs against the
 * already-escaped text. The only tags this function can ever emit are the
 * five it generates itself (p/strong/em/ul/li); nothing in the source text
 * can inject a real tag or attribute, so the result is safe to hand to
 * `dangerouslySetInnerHTML` as-is.
 */
export function renderMarkdownLite(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const escaped = escapeHtml(trimmed);

  const blocks = escaped
    .split(/\n[ \t]*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const html = blocks
    .map((block) => {
      const lines = block
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const isList = lines.length > 0 && lines.every((l) => l.startsWith('- '));
      if (isList) {
        return `<ul>${lines.map((l) => `<li>${l.slice(2).trim()}</li>`).join('')}</ul>`;
      }
      return `<p>${lines.join(' ')}</p>`;
    })
    .join('');

  return renderInline(html);
}
