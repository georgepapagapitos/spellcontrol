/** One explainer for the query language every Add cards tab's search box understands. */
export const SYNTAX_TIP = (
  <>
    <p className="info-tip-lead">Search by name, rules text, or Scryfall-style filters:</p>
    <ul className="info-tip-list">
      <li>
        <code>o:draw</code> rules text · <code>t:instant</code> type
      </li>
      <li>
        <code>otag:removal</code> oracle tag · <code>r:rare</code> rarity
      </li>
      <li>
        <code>cmc&lt;=2</code> mana value · <code>c:UG</code> colors
      </li>
      <li>
        <code>-t:land</code> excludes · <code>OR</code> combines
      </li>
      <li>↑ ↓ navigate · Enter adds · Esc closes</li>
    </ul>
  </>
);
