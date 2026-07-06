import { useEffect, useId, useRef, useState } from 'react';
import { Sparkles, Wrench, Palette, Hourglass, WifiOff } from 'lucide-react';
import type { Customization, GenerationMode, ScryfallCard } from '@/deck-builder/types';
import { searchCardsLive } from '@/deck-builder/services/scryfall/client';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import {
  ART_THEME_PRESETS,
  HISTORICAL_PRESETS,
  HISTORICAL_MIN_YEAR,
  slugifyTag,
} from '@/deck-builder/services/deckBuilder/phaseAlternatePool';
import './GenerationModePicker.css';

const CURRENT_YEAR = 2024; // ceiling for the era slider (kept static for determinism)

interface ModeDef {
  id: GenerationMode;
  label: string;
  tag: string;
  icon: typeof Sparkles;
  blurb: string;
  /** Needs the live Scryfall API (disabled offline). */
  online: boolean;
}

const MODES: readonly ModeDef[] = [
  {
    id: 'edhrec',
    label: 'Standard',
    tag: 'EDHREC',
    icon: Sparkles,
    blurb: 'The popular picks other players run with your commander.',
    online: false,
  },
  {
    id: 'oracle-role',
    label: 'By Function',
    tag: 'Scryfall',
    icon: Wrench,
    blurb:
      'Pure card function — ramp, removal, draw — ranked by playability. Works for any commander.',
    online: true,
  },
  {
    id: 'art-theme',
    label: 'By Art',
    tag: 'Scryfall',
    icon: Palette,
    blurb: 'Every card depicts one motif. A deck that looks like a curated gallery.',
    online: true,
  },
  {
    id: 'historical',
    label: 'By Era',
    tag: 'Scryfall',
    icon: Hourglass,
    blurb: "Only cards from a slice of Magic's past — an old-school build puzzle.",
    online: true,
  },
];

interface Props {
  customization: Customization;
  update: (patch: Partial<Customization>) => void;
  /** Commander color identity — scopes the live previews to legal cards. */
  colorIdentity: string[];
  commanderName?: string;
  /** 'all' (default) renders cards + config together (quick-build page). The
   *  guided wizard splits them: 'cards' to pick the approach, 'config' to tune it. */
  section?: 'all' | 'cards' | 'config';
  /** PDH build: the default mode sources from the PDH-legal Scryfall pool,
   *  not EDHREC — the Standard card says so. */
  pdh?: boolean;
}

/** Live online/offline flag (the Scryfall modes need a connection). */
function useOnline(): boolean {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function GenerationModePicker({
  customization,
  update,
  colorIdentity,
  commanderName,
  section = 'all',
  pdh = false,
}: Props) {
  const online = useOnline();
  const mode = customization.generationMode;
  const groupLabelId = useId();

  const showCards = section !== 'config';
  const showConfig = section !== 'cards' && mode !== 'edhrec';

  // The 'config' section may render standalone (guided wizard) with nothing else;
  // give it its own card-style container in that case for a complete surface.
  const configStandalone = section === 'config';

  return (
    <section className="deck-builder-section gen-mode">
      {showCards && (
        <>
          <h2 className="deck-builder-section-title" id={groupLabelId}>
            How should we build?
          </h2>
          <p className="gen-mode-intro">
            Generate the deck a different way — by what cards <em>do</em>, what they <em>depict</em>
            , or when they were <em>printed</em>.
          </p>

          {!online && (
            <p className="gen-mode-offline" role="status">
              <WifiOff width={14} height={14} strokeWidth={2} aria-hidden /> The Scryfall-powered
              modes need a connection. They'll switch on when you're back online.
            </p>
          )}

          <div className="gen-mode-grid" role="radiogroup" aria-labelledby={groupLabelId}>
            {MODES.map((m) => {
              const Icon = m.icon;
              // PDH always builds from live Scryfall searches — the Standard
              // card is a Scryfall mode there too (and needs a connection).
              const isPdhStandard = pdh && m.id === 'edhrec';
              const disabled = (m.online || isPdhStandard) && !online;
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={disabled}
                  className={`gen-mode-card${active ? ' is-active' : ''}`}
                  onClick={() => update({ generationMode: m.id })}
                >
                  <span className="gen-mode-card-head">
                    <Icon width={18} height={18} strokeWidth={2} aria-hidden />
                    <span className="gen-mode-card-label">{m.label}</span>
                    <span className="gen-mode-card-tag">{isPdhStandard ? 'Scryfall' : m.tag}</span>
                  </span>
                  <span className="gen-mode-card-blurb">
                    {isPdhStandard
                      ? 'A balanced build from Pauper Commander–legal cards, chosen by function.'
                      : m.blurb}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Standard mode in the guided 'config' slot: nothing to tune — say so. */}
      {section === 'config' && mode === 'edhrec' && (
        <p className="gen-mode-explain">
          Standard mode uses EDHREC's popular picks for your commander — no extra tuning needed
          here.
        </p>
      )}

      {showConfig && (
        <div className={configStandalone ? 'gen-mode-config is-standalone' : 'gen-mode-config'}>
          {mode === 'oracle-role' && <OracleConfig customization={customization} update={update} />}
          {mode === 'art-theme' && (
            <ArtConfig
              customization={customization}
              update={update}
              colorIdentity={colorIdentity}
              commanderName={commanderName}
            />
          )}
          {mode === 'historical' && (
            <HistoricalConfig
              customization={customization}
              update={update}
              colorIdentity={colorIdentity}
            />
          )}
        </div>
      )}
    </section>
  );
}

// ── Oracle Role config ───────────────────────────────────────────────────────

function OracleConfig({ customization, update }: Pick<Props, 'customization' | 'update'>) {
  return (
    <>
      <p className="gen-mode-explain">
        We ignore crowd data and pick the strongest cards for each <strong>role</strong> in your
        colors — a solid functional deck for any commander, even ones EDHREC barely covers.
      </p>
      <label className="gen-mode-toggle">
        <input
          type="checkbox"
          checked={customization.permanentsOnly}
          onChange={(e) => update({ permanentsOnly: e.target.checked })}
        />
        <span>
          <strong>Permanents only</strong>
          <span className="gen-mode-toggle-hint">
            No instants or sorceries — every nonland is a permanent, so the deck dodges
            counterspells.
          </span>
        </span>
      </label>
    </>
  );
}

// ── Art Theme config ─────────────────────────────────────────────────────────

function ArtConfig({
  customization,
  update,
  colorIdentity,
  commanderName,
}: Pick<Props, 'customization' | 'update' | 'colorIdentity' | 'commanderName'>) {
  const tag = customization.artThemeTag;
  const slug = slugifyTag(tag);

  return (
    <>
      <p className="gen-mode-explain">
        Pick a motif. Every nonland card will <strong>depict it</strong> — and we'll choose the
        printing whose art matches, so the finished list reads like a gallery.
      </p>
      <div className="gen-mode-chips" role="group" aria-label="Art motifs">
        {ART_THEME_PRESETS.map((p) => (
          <button
            key={p.tag}
            type="button"
            className={`gen-mode-chip${slug === p.tag ? ' is-active' : ''}`}
            aria-pressed={slug === p.tag}
            onClick={() => update({ artThemeTag: p.tag })}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label className="gen-mode-field">
        <span className="gen-mode-field-label">Or type any motif</span>
        <input
          type="text"
          className="gen-mode-input"
          value={tag}
          placeholder="e.g. lightning, ship, skull…"
          onChange={(e) => update({ artThemeTag: e.target.value })}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <ScryfallPreview
        query={slug ? `art:${slug} -t:land` : ''}
        colorIdentity={colorIdentity}
        caption={(n) =>
          `≈${n.toLocaleString()} cards depict ${labelFor(tag)}${commanderName ? ` in ${commanderName}'s colors` : ''}`
        }
        emptyHint={`No cards depict “${tag.trim()}” in these colors — try another motif.`}
      />
    </>
  );
}

// ── Historical config ────────────────────────────────────────────────────────

function HistoricalConfig({
  customization,
  update,
  colorIdentity,
}: Pick<Props, 'customization' | 'update' | 'colorIdentity'>) {
  const year = customization.historicalYear;
  return (
    <>
      <p className="gen-mode-explain">
        Build with only cards printed <strong>on or before {year}</strong>. Niche colors may reach
        forward a few years to find enough cards.
      </p>
      <div className="gen-mode-chips" role="group" aria-label="Eras">
        {HISTORICAL_PRESETS.map((p) => (
          <button
            key={p.year}
            type="button"
            className={`gen-mode-chip${year === p.year ? ' is-active' : ''}`}
            aria-pressed={year === p.year}
            title={p.blurb}
            onClick={() => update({ historicalYear: p.year })}
          >
            {p.label}
            <span className="gen-mode-chip-sub">≤{p.year}</span>
          </button>
        ))}
      </div>
      <label className="gen-mode-field">
        <span className="gen-mode-field-label">
          Fine-tune the cutoff: <strong className="gen-mode-year">{year}</strong>
        </span>
        <input
          type="range"
          className="gen-mode-slider"
          min={HISTORICAL_MIN_YEAR}
          max={CURRENT_YEAR}
          step={1}
          value={year}
          onChange={(e) => update({ historicalYear: Number(e.target.value) })}
          aria-label="Print-year cutoff"
        />
      </label>
      <ScryfallPreview
        query={`year<=${year} -t:land`}
        colorIdentity={colorIdentity}
        caption={(n) => `≈${n.toLocaleString()} cards were printed through ${year} in these colors`}
        emptyHint="Almost nothing that old in these colors — we'll reach forward when building."
      />
    </>
  );
}

// ── Shared live preview ──────────────────────────────────────────────────────

function labelFor(raw: string): string {
  const t = raw.trim();
  return t ? t.toLowerCase() : 'this motif';
}

/** Front-face art crop for a card (handles DFCs). */
function artCrop(card: ScryfallCard): string | undefined {
  return card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop;
}

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ok'; total: number; crops: string[] }
  | { status: 'error' };

function ScryfallPreview({
  query,
  colorIdentity,
  caption,
  emptyHint,
}: {
  query: string;
  colorIdentity: string[];
  caption: (total: number) => string;
  emptyHint: string;
}) {
  const debounced = useDebouncedValue(query, 350);
  const colorKey = colorIdentity.join('');
  const [state, setState] = useState<PreviewState>({ status: 'idle' });
  // Guards against out-of-order responses clobbering the latest query's result.
  const reqRef = useRef(0);

  useEffect(() => {
    let active = true; // cleared on unmount/re-run so we never setState late
    const reqId = ++reqRef.current;
    // Inner async fn (vs. setState directly in the effect body) keeps the
    // synchronous loading transition out of react-hooks/set-state-in-effect.
    async function run() {
      if (!debounced) {
        setState({ status: 'idle' });
        return;
      }
      setState({ status: 'loading' });
      try {
        const res = await searchCardsLive(debounced, colorIdentity, { order: 'edhrec' });
        if (!active || reqRef.current !== reqId) return;
        if (res.total_cards === 0) {
          setState({ status: 'empty' });
          return;
        }
        const crops = res.data
          .map(artCrop)
          .filter((c): c is string => Boolean(c))
          .slice(0, 6);
        setState({ status: 'ok', total: res.total_cards, crops });
      } catch {
        // A query that matches nothing 404s on Scryfall — treat as empty, not error.
        if (active && reqRef.current === reqId) setState({ status: 'empty' });
      }
    }
    void run();
    return () => {
      active = false;
    };
    // colorKey participates so a color-identity change refetches.
  }, [debounced, colorIdentity, colorKey]);

  if (state.status === 'idle') {
    return <p className="gen-mode-preview-hint">Pick or type a motif to preview the pool.</p>;
  }

  return (
    <div className="gen-mode-preview" aria-live="polite">
      <div className="gen-mode-preview-strip">
        {state.status === 'loading' &&
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="gen-mode-preview-tile is-skeleton" aria-hidden />
          ))}
        {state.status === 'ok' &&
          state.crops.map((src) => (
            <div key={src} className="gen-mode-preview-tile">
              <img src={src} alt="" loading="lazy" />
            </div>
          ))}
        {(state.status === 'empty' || state.status === 'error') &&
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="gen-mode-preview-tile is-blank" aria-hidden />
          ))}
      </div>
      <p className={`gen-mode-preview-caption${state.status === 'empty' ? ' is-empty' : ''}`}>
        {state.status === 'loading' && 'Counting matching cards…'}
        {state.status === 'ok' && caption(state.total)}
        {state.status === 'empty' && emptyHint}
        {state.status === 'error' && "Couldn't reach Scryfall — try again."}
      </p>
    </div>
  );
}
