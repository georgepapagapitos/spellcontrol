// Card context vectors from deck co-occurrence (E517 slice C experiment).
// Each card is a sparse vector of positive PMI against the cards it shares decks with; two cards
// that sit in the same kinds of decks have a high cosine. Input is E516's cooccurrence.json
// ({ cards, deckCounts, deckCount, pairs: [i, j, decksWithBoth] }).

/** @returns Map<name, { cos(other): number }> */
export function buildCooc(data, shrink = 0, topK = 0) {
  const { cards, deckCounts, deckCount: N, pairs } = data;
  const rows = cards.map(() => new Map());
  for (const [i, j, c] of pairs) {
    const pmi = Math.log((c * N) / (deckCounts[i] * deckCounts[j]));
    if (pmi <= 0) continue;
    const w = shrink > 0 ? (pmi * c) / (c + shrink) : pmi;
    rows[i].set(j, w);
    rows[j].set(i, w);
  }
  const out = new Map();
  cards.forEach((name, i) => {
    let r = rows[i];
    if (topK > 0 && r.size > topK) r = new Map([...r].sort((a, b) => b[1] - a[1]).slice(0, topK));
    if (r.size === 0) return;
    let norm = 0;
    for (const v of r.values()) norm += v * v;
    norm = Math.sqrt(norm);
    out.set(name, {
      r,
      norm,
      cos(o) {
        const [small, big] = this.r.size <= o.r.size ? [this.r, o.r] : [o.r, this.r];
        let d = 0;
        for (const [k, v] of small) {
          const u = big.get(k);
          if (u !== undefined) d += v * u;
        }
        return d / (this.norm * o.norm);
      },
    });
  });
  return out;
}
