import type { EnrichedCard } from '../types';
import { classifyFoil } from '../lib/foil-style';
import { useHolographic } from '../lib/use-holographic';

interface Props {
  card: EnrichedCard;
  /**
   * Whether this frame should bind the holographic tilt listener. In the
   * carousel only the focused slide is active (the rest render flat); a
   * standalone surface like the deck detail pane is always active. Disabled
   * frames still mount the same DOM — `useHolographic(false)` just skips the
   * mousemove/rAF work — so the 3D frame, foil overlays, and flip all behave
   * identically; only the cursor-tracked tilt is gated.
   */
  active?: boolean;
  /** Show the back face (transform/DFC cards). */
  flipped: boolean;
  /**
   * Carousel windowing defers the heavy 3D frame contents until a slide is
   * within the mount radius. Standalone surfaces leave this true.
   */
  mounted?: boolean;
  imgLoaded: boolean;
  imgErrored: boolean;
  onImgLoad: () => void;
  onImgError: () => void;
  /** The focused slide loads eagerly / high priority; peeking neighbors lazy. */
  eager?: boolean;
  /**
   * Getter the carousel passes so tilt is pinned to flat while a parent-owned
   * swipe gesture controls the axis. Static surfaces omit it.
   */
  shouldSuppressTilt?: () => boolean;
}

/**
 * The 3D-transformed card image frame used by the full-screen `CardPreview`
 * carousel. Owns the holographic/foil shimmer (via `useHolographic` +
 * `classifyFoil`) and the front/back flip, extracted from the carousel so the
 * foil/flip logic lives in one place. Everything outside the frame (the sheet
 * chrome, the carousel scroll track, the info panel) stays with the carousel.
 */
export function CardImageFrame({
  card,
  active = true,
  flipped,
  mounted = true,
  imgLoaded,
  imgErrored,
  onImgLoad,
  onImgError,
  eager,
  shouldSuppressTilt,
}: Props) {
  const style = classifyFoil(card);
  const foilClass = style !== 'none' ? ` is-foil foil-${style}` : '';
  // enableGyro: foil/etched cards only — the gyro tilt is the "physical binder"
  // fantasy and only reads naturally when there is shimmer to move. Non-foil cards
  // stay flat on native (cursor tilt still works on desktop via the pointer path).
  const holoRef = useHolographic(active, { shouldSuppressTilt, enableGyro: style !== 'none' });

  return (
    <div className={`card-preview-image-frame${foilClass}`} ref={holoRef}>
      {mounted && (
        <div className={`card-preview-flipper${flipped ? ' is-flipped' : ''}`}>
          <div className="card-preview-face card-preview-face-front">
            {card.imageNormal && !imgErrored ? (
              <>
                {!imgLoaded && <div className="card-preview-image-skeleton" aria-hidden="true" />}
                <img
                  // Hero drawer can grow to ~620px on desktop; `large` (672w)
                  // stays sharp there where `normal` (488w) would upscale.
                  // Falls back to normal for cards enriched before imageLarge
                  // existed. Grids/thumbnails keep using normal.
                  src={card.imageLarge || card.imageNormal}
                  alt={card.name}
                  className="card-preview-image"
                  draggable={false}
                  // All slides decode async: a synchronous decode of the
                  // ~672×936 hero (a different, usually-uncached URL than the
                  // grid's normal art) lands mid-rise and stutters it. Let the
                  // skeleton→image cross-fade cover the arrival instead.
                  decoding="async"
                  loading={eager ? 'eager' : 'lazy'}
                  fetchPriority={eager ? 'high' : 'auto'}
                  // Cached images may already be complete before onLoad can
                  // attach — mark them loaded on mount so the skeleton doesn't
                  // linger forever (and so a re-mounted frame doesn't flash one).
                  ref={(el) => {
                    if (el?.complete && el.naturalWidth > 0) onImgLoad();
                  }}
                  onLoad={onImgLoad}
                  onError={onImgError}
                />
              </>
            ) : card.imageNormal && imgErrored ? (
              <div className="card-preview-image-fallback">Image unavailable</div>
            ) : null}
            {card.foil && (
              <>
                <div className="card-preview-foil-shine" aria-hidden="true" />
                <div className="card-preview-foil-glare" aria-hidden="true" />
              </>
            )}
          </div>
          {card.imageNormalBack && (
            <div className="card-preview-face card-preview-face-back">
              <img
                src={card.imageLargeBack || card.imageNormalBack}
                alt={`${card.name} (back)`}
                className="card-preview-image"
                draggable={false}
                decoding="async"
              />
              {card.foil && (
                <>
                  <div className="card-preview-foil-shine" aria-hidden="true" />
                  <div className="card-preview-foil-glare" aria-hidden="true" />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
