# Scanner accuracy benchmark

Measures how often the scanner's matching stack names the right card, on
synthetic camera-like queries built from Scryfall art. The public write-up is
`frontend/public/guides/scanner-accuracy.html`; its numbers are pinned to
`results.json` here by `benchmark.test.ts`.

**The queries are synthetic.** They approximate what goes wrong between a card
and the matcher. They are not photographs, and a real phone will do better on
some failures and worse on others. A real-camera run (E441) is a separate,
later measurement.

## What is scored

The client sends the art window of the perspective-corrected card crop; the
index was built from Scryfall `art_crop` images. So a query here is an
`art_crop` image, degraded. Three stages answer each query:

| Stage       | What answers                                                         | Top-3 means                         |
| ----------- | -------------------------------------------------------------------- | ----------------------------------- |
| `hash`      | 64-bit pHash, nearest Hamming distance over the whole index          | the 3 nearest hashes                |
| `embedding` | MobileCLIP2-S0 vision embedding, cosine search over the whole index  | the 3 highest cosines               |
| `pipeline`  | `createMatcher().match()`, the code behind `POST /api/scanner/match` | the candidates the matcher returned |

For `pipeline`, a `confident` answer returns one card, a `borderline` answer
returns up to five (the picker the user sees), and a `miss` returns none and
counts as wrong. The tally also records how many confident answers were wrong
(`confidentWrong`), which matters more than top-1: a wrong confident answer
adds the wrong card without asking.

Timing is wall milliseconds per query on the machine that ran it
(`meta.platform`), not a production latency.

## Corpus

`corpus.json`: `seed` 20261102, mulberry32 (`rng.ts`). `drawIds` draws
`drawn` distinct positions from the committed `card-hashes.bin`
(`indexRecords` records at the time), the CLI resolves them on Scryfall
(`POST /cards/collection`) and keeps the first 200 that have an `art_crop`.
The file lists id and name for each. Re-draw with the CLI; fetch the same
cards by id without it.

The first `gateSize` (20) cards are the CI subset. Their source images are
committed in `fixtures/` so the gate needs no network.

## Degradations (`degrade.ts`)

Each is deterministic in (card id, condition): the generator is seeded from
`"<id>:<condition>"`. Order applied: perspective, glare, occlusion, blur,
noise, JPEG encode. The client uploads JPEG quality 90, so every degraded
condition ends in a JPEG encode; `clean` is the unmodified source.

| Condition   | Done to the image                                                                             |
| ----------- | --------------------------------------------------------------------------------------------- |
| clean       | Nothing. The control: the index was built from these images.                                  |
| perspective | Projective warp, each corner moved up to 6% of the frame, bilinear, edge replicate. Q90.      |
| blur        | Gaussian blur sigma 4 px at about 626 px wide. Q90.                                           |
| glare       | Soft white highlight at a random spot, peak 85%, radius 35% of width. Q90.                    |
| noise       | Gaussian noise, standard deviation 14 of 255 per channel, then JPEG quality 35.               |
| occlusion   | Opaque dark strip hiding 20% of the area along a random edge. Q90.                            |
| combined    | 4% perspective, blur 2, glare 60% over 30% of width, 10% occlusion, noise 8, JPEG quality 50. |

What this does not model: lens distortion, rolling shutter, white balance and
exposure shifts, sleeve and foil texture, and a crop that frames the art
differently from Scryfall's `art_crop` (the perspective condition covers a
small part of that).

## Running

From `backend/`:

```bash
npm run scanner:bench -- corpus                 # re-draw corpus.json (rarely needed)
npm run scanner:bench -- fetch --fixtures       # art into .cache/scanner-bench, CI subset into fixtures/
npm run scanner:bench -- run --stages hash      # seconds; no LFS needed
npm run scanner:bench -- run --write            # all stages, whole corpus, updates results.json
```

The `embedding` and `pipeline` stages need `card-embeddings.bin` as the real
file (`git lfs pull`). A full run is about 10 minutes on a laptop.

## Gates

- **Every CI run:** `benchmark.test.ts` scores the 20-card subset with the
  `hash` stage (about 10 s, no LFS) and fails if top-1 drops under the floor
  for any condition.
- **On demand:** the `Scanner Benchmark` workflow (`workflow_dispatch`) pulls
  LFS, holds the subset to the production matcher
  (`SCANNER_BENCH_PIPELINE=1`), and can run the whole corpus. The default CI
  checkout has no LFS, so this stage cannot run in the required checks.

After changing the matcher, thresholds, hashing or the index format, re-run
`run --write`, update the floors in `benchmark.test.ts` if the measured
numbers moved on purpose, and update the page.
