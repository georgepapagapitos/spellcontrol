import { useId, useMemo, useState } from 'react';
import { ExternalLink, RotateCw } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { ManaCost } from '@/components/ManaCost';
import { CardLegalities, CardText } from '@/components/CardDetails';
import { CardRulings } from '@/components/CardRulings';
import { RarityBadge } from '@/components/shared/RarityBadge';
import { scryfallToEnrichedCard } from '@/lib/scryfall-to-enriched';
import { formatMoney } from '@/lib/format-money';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import type { ScryfallCard } from '@/deck-builder/types';
import { CardStatusStrip, type CardStatusStripProps } from './CardStatusStrip';
import './CardInfoDialog.css';

/** Scryfall card UUID — gates the rulings fetch to real printings. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "View information" from a card's table menu — the card, read.
 *
 * Deliberately NOT `CardPreview`: that carousel is a browsing surface (a hand,
 * a zone, a binder page — flanking slides, swipe, a full-height side panel),
 * and pointing it at exactly one card blew a single permanent up to the whole
 * screen with its rules text stranded in a rail down the right edge. Asking
 * what a permanent does mid-game is a glance, not a browse: one centered
 * dialog, art beside text, rulings already open, dismissed with Escape.
 *
 * Every field comes from the `ScryfallCard` the board already holds, so there
 * is no fetch and no loading state — apart from rulings, which are lazy by
 * design (`CardRulings`) and the one thing here that can be slow.
 */
export function CardInfoDialog({
  card,
  status,
  onClose,
}: {
  card: ScryfallCard;
  /** Live board facts for this card, when it has any — forwarded straight to
   *  `CardStatusStrip`, which renders nothing when they're all empty. */
  status?: CardStatusStripProps;
  onClose: () => void;
}) {
  const titleId = useId();
  const enriched = useMemo(() => scryfallToEnrichedCard(card), [card]);

  // Faces that carry their own art (transform / modal DFCs). Split and flip
  // cards have two faces but one image, so they never offer the flip.
  const artFaces = useMemo(
    () => (card.card_faces ?? []).filter((f) => f.image_uris?.normal),
    [card]
  );
  const [face, setFace] = useState(0);
  const image = artFaces.length > 1 ? artFaces[face].image_uris?.normal : enriched.imageNormal;

  // Front face only, both of them: `EnrichedCard.manaCost` joins a DFC's
  // faces with "//", and a transform card's back face has no cost — so the
  // header rendered "{U} //" with nothing after the separator. The per-face
  // breakdown below (`CardText`) already prints each face's own cost beside
  // its name, so the header is the front of the card and nothing else.
  const typeLine = getFrontFaceTypeLine(card) ?? card.type_line;
  const manaCost = card.mana_cost || card.card_faces?.[0]?.mana_cost;
  const stat =
    card.power != null && card.toughness != null
      ? `${card.power}/${card.toughness}`
      : card.loyalty
        ? `Loyalty ${card.loyalty}`
        : null;

  const scryfallUrl =
    card.set && card.collector_number
      ? `https://scryfall.com/card/${card.set.toLowerCase()}/${card.collector_number}`
      : undefined;
  const priceUrl = `https://www.tcgplayer.com/search/magic/product?q=${encodeURIComponent(card.name)}&view=grid`;

  return (
    <Modal onClose={onClose} className="modal card-info-dialog" labelledBy={titleId}>
      <header className="modal-header">
        <h2 id={titleId}>{card.name}</h2>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>

      <div className="modal-body card-info-body">
        <div className="card-info-art">
          {image ? (
            <img src={image} alt="" draggable={false} />
          ) : (
            <div className="card-info-art-missing">No art</div>
          )}
          {artFaces.length > 1 && (
            <button
              type="button"
              className="btn card-info-flip"
              onClick={() => setFace((f) => (f + 1) % artFaces.length)}
            >
              <RotateCw width={14} height={14} strokeWidth={2.2} aria-hidden />
              {artFaces[(face + 1) % artFaces.length].name}
            </button>
          )}
        </div>

        {/* What the card does comes before which printing it is — on a phone
            this column lands directly under the art, where the player is
            already looking. */}
        <div className="card-info-rules">
          <div className="card-info-typeline">
            <span>{typeLine}</span>
            <ManaCost cost={manaCost} />
          </div>
          {status && <CardStatusStrip {...status} />}
          <CardText card={enriched} detail={card} />
          {stat && <p className="card-info-stat">{stat}</p>}
          {UUID_RE.test(card.id ?? '') && (
            <CardRulings key={card.id} scryfallId={card.id} defaultOpen />
          )}
        </div>

        <div className="card-info-meta">
          <p className="card-info-printing">
            <RarityBadge rarity={card.rarity} />
            <span>
              {card.set_name}
              {card.set && ` (${card.set.toUpperCase()})`}
              {card.collector_number && ` · #${card.collector_number}`}
            </span>
          </p>

          <CardLegalities legalities={card.legalities} />

          <div className="card-info-links">
            <ExternalAnchor href={priceUrl} label={formatMoney(enriched.purchasePrice)} />
            {scryfallUrl && <ExternalAnchor href={scryfallUrl} label="Scryfall" />}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** An outbound link that hands off to the system browser on native, where an
 *  in-WebView navigation would replace the game the user is sitting in. */
function ExternalAnchor({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="card-info-link">
      {label}
      <ExternalLink width={12} height={12} strokeWidth={2.4} aria-hidden />
    </a>
  );
}
