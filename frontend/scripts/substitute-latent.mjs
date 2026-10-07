// Latent card vectors for the substitute eval's slice B experiment (E517): a
// truncated SVD (randomized range finder + two power iterations) of the
// IDF-weighted card × tag matrix that card-facts already provides. Nothing
// here ships: the eval asks whether a dense, smoothed version of the tag
// overlap the ranker already measures adds anything on the graded benchmark.
// Deterministic (seeded).

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal from a uniform source (Box-Muller). */
function gaussian(rand) {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/**
 * @param tagsOf   per card, its tag list
 * @param idf      tag → IDF weight
 * @param k        output dimensions
 * @returns Float32Array(n * k), rows L2-normalized
 */
export function buildLatent(tagsOf, idf, k = 64, minDf = 3) {
  const n = tagsOf.length;
  const df = new Map();
  for (const tags of tagsOf) for (const t of tags) df.set(t, (df.get(t) ?? 0) + 1);
  const vocab = new Map();
  for (const [t, c] of df) if (c >= minDf) vocab.set(t, vocab.size);
  const V = vocab.size;
  // CSR rows of the L2-normalized IDF-weighted matrix.
  const rows = tagsOf.map((tags) => {
    const cols = [];
    const vals = [];
    for (const t of tags) {
      const j = vocab.get(t);
      if (j !== undefined) {
        cols.push(j);
        vals.push(idf.get(t) ?? 1);
      }
    }
    const norm = Math.sqrt(vals.reduce((s, v) => s + v * v, 0)) || 1;
    return { cols: Int32Array.from(cols), vals: Float64Array.from(vals.map((v) => v / norm)) };
  });
  const r = k + 16;
  const rand = mulberry32(20260929);

  // X·M for a V×r matrix M (row-major Float64Array) → n×r.
  const mulX = (M, width) => {
    const out = new Float64Array(n * width);
    for (let i = 0; i < n; i++) {
      const { cols, vals } = rows[i];
      for (let p = 0; p < cols.length; p++) {
        const base = cols[p] * width;
        const v = vals[p];
        for (let c = 0; c < width; c++) out[i * width + c] += v * M[base + c];
      }
    }
    return out;
  };
  // Xᵀ·Q for an n×r matrix Q → V×r.
  const mulXt = (Q, width) => {
    const out = new Float64Array(V * width);
    for (let i = 0; i < n; i++) {
      const { cols, vals } = rows[i];
      for (let p = 0; p < cols.length; p++) {
        const base = cols[p] * width;
        const v = vals[p];
        for (let c = 0; c < width; c++) out[base + c] += v * Q[i * width + c];
      }
    }
    return out;
  };
  // Orthonormalize the columns of an n×width matrix in place (modified Gram-Schmidt).
  const orthonormalize = (A, width) => {
    for (let c = 0; c < width; c++) {
      for (let d = 0; d < c; d++) {
        let dot = 0;
        for (let i = 0; i < n; i++) dot += A[i * width + c] * A[i * width + d];
        for (let i = 0; i < n; i++) A[i * width + c] -= dot * A[i * width + d];
      }
      let norm = 0;
      for (let i = 0; i < n; i++) norm += A[i * width + c] ** 2;
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < n; i++) A[i * width + c] /= norm;
    }
  };

  const omega = new Float64Array(V * r);
  for (let i = 0; i < omega.length; i++) omega[i] = gaussian(rand);
  let Q = mulX(omega, r);
  orthonormalize(Q, r);
  for (let it = 0; it < 2; it++) {
    const Z = mulXt(Q, r);
    // Orthonormalize Z (V×r) the same way, over V rows.
    for (let c = 0; c < r; c++) {
      for (let d = 0; d < c; d++) {
        let dot = 0;
        for (let i = 0; i < V; i++) dot += Z[i * r + c] * Z[i * r + d];
        for (let i = 0; i < V; i++) Z[i * r + c] -= dot * Z[i * r + d];
      }
      let norm = 0;
      for (let i = 0; i < V; i++) norm += Z[i * r + c] ** 2;
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < V; i++) Z[i * r + c] /= norm;
    }
    Q = mulX(Z, r);
    orthonormalize(Q, r);
  }
  // B = Qᵀ·X (r×V) → Gram G = B·Bᵀ (r×r), eigendecomposed by Jacobi.
  const Bt = mulXt(Q, r); // V×r, i.e. Bᵀ
  const G = Array.from({ length: r }, () => new Float64Array(r));
  for (let j = 0; j < V; j++)
    for (let a = 0; a < r; a++) {
      const x = Bt[j * r + a];
      if (x === 0) continue;
      for (let b = a; b < r; b++) G[a][b] += x * Bt[j * r + b];
    }
  for (let a = 0; a < r; a++) for (let b = 0; b < a; b++) G[a][b] = G[b][a];
  const U = Array.from({ length: r }, (_, i) =>
    Float64Array.from({ length: r }, (_, j) => +(i === j))
  );
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < r; p++) for (let q = p + 1; q < r; q++) off += G[p][q] ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < r; p++)
      for (let q = p + 1; q < r; q++) {
        if (Math.abs(G[p][q]) < 1e-14) continue;
        const theta = (G[q][q] - G[p][p]) / (2 * G[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let i = 0; i < r; i++) {
          const gip = G[i][p];
          const giq = G[i][q];
          G[i][p] = c * gip - s * giq;
          G[i][q] = s * gip + c * giq;
        }
        for (let i = 0; i < r; i++) {
          const gpi = G[p][i];
          const gqi = G[q][i];
          G[p][i] = c * gpi - s * gqi;
          G[q][i] = s * gpi + c * gqi;
        }
        for (let i = 0; i < r; i++) {
          const uip = U[i][p];
          const uiq = U[i][q];
          U[i][p] = c * uip - s * uiq;
          U[i][q] = s * uip + c * uiq;
        }
      }
  }
  const order = Array.from({ length: r }, (_, i) => i)
    .sort((a, b) => G[b][b] - G[a][a])
    .slice(0, k);
  // embedding_i = Σ_j Q[i][j] · (Ũ·S)[j][comp], S = sqrt(eigenvalue)
  const out = new Float32Array(n * k);
  for (let i = 0; i < n; i++) {
    let norm = 0;
    for (let c = 0; c < k; c++) {
      const comp = order[c];
      const s = Math.sqrt(Math.max(G[comp][comp], 0));
      let v = 0;
      for (let j = 0; j < r; j++) v += Q[i * r + j] * U[j][comp];
      v *= s;
      out[i * k + c] = v;
      norm += v * v;
    }
    norm = Math.sqrt(norm) || 1;
    for (let c = 0; c < k; c++) out[i * k + c] /= norm;
  }
  return { vectors: out, k, vocab: V };
}
