import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchPublicShare, ShareNotFoundError } from '../lib/share-client';
import type {
  PublicCard,
  PublicCollection,
  PublicDeck,
  PublicList,
  PublicShareResponse,
} from '../lib/shared-types';

/**
 * Public read-only view for /s/:token. Fetches via the unauthed public
 * endpoint and renders a per-kind view. **Does not write to any zustand
 * store** — the sync invariants require the owner's stores stay isolated
 * from anyone else's data we happen to load.
 */
export function SharedView() {
  const { token } = useParams<{ token: string }>();
  if (!token) return <NotFoundView />;
  // Remount on token change so per-link state is fresh and the effect runs once.
  return <SharedViewInner key={token} token={token} />;
}

function NotFoundView() {
  return (
    <main className="shared-view shared-view--missing">
      <h1>Link not found</h1>
      <p>This share link is invalid or has been revoked.</p>
    </main>
  );
}

function SharedViewInner({ token }: { token: string }) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'notFound' }
    | { status: 'error'; message: string }
    | { status: 'ready'; payload: PublicShareResponse }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchPublicShare(token)
      .then((payload) => {
        if (!cancelled) setState({ status: 'ready', payload });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ShareNotFoundError) {
          setState({ status: 'notFound' });
        } else {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to load shared content.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.status === 'loading') {
    return (
      <main className="shared-view shared-view--loading" aria-busy="true">
        <p>Loading…</p>
      </main>
    );
  }
  if (state.status === 'notFound') {
    return <NotFoundView />;
  }
  if (state.status === 'error') {
    return (
      <main className="shared-view shared-view--error">
        <h1>Something went wrong</h1>
        <p>{state.message}</p>
      </main>
    );
  }

  const { payload } = state;
  if (payload.kind === 'collection') {
    return <SharedCollection data={payload.data} />;
  }
  if (payload.kind === 'deck') {
    return <SharedDeck data={payload.data} />;
  }
  return <SharedList data={payload.data} />;
}

function SharedHeader({
  ownerUsername,
  title,
  subtitle,
}: {
  ownerUsername: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="shared-view-header">
      <p className="shared-view-owner">Shared by @{ownerUsername}</p>
      <h1 className="shared-view-title">{title}</h1>
      {subtitle && <p className="shared-view-subtitle">{subtitle}</p>}
    </header>
  );
}

function SharedCollection({ data }: { data: PublicCollection }) {
  const total = data.cards.length;
  const value = data.cards.reduce((sum, c) => sum + c.purchasePrice, 0);
  return (
    <main className="shared-view">
      <SharedHeader
        ownerUsername={data.ownerUsername}
        title="Collection"
        subtitle={`${total.toLocaleString()} ${total === 1 ? 'card' : 'cards'} · $${value.toFixed(0)}`}
      />
      <CardGrid cards={data.cards} />
    </main>
  );
}

function SharedList({ data }: { data: PublicList }) {
  const total = data.entries.reduce((s, e) => s + e.quantity, 0);
  return (
    <main className="shared-view">
      <SharedHeader
        ownerUsername={data.ownerUsername}
        title={data.name}
        subtitle={`${total.toLocaleString()} ${total === 1 ? 'card' : 'cards'} · ${data.entries.length} ${data.entries.length === 1 ? 'entry' : 'entries'}`}
      />
      <table className="shared-list-table">
        <thead>
          <tr>
            <th>Qty</th>
            <th>Name</th>
            <th>Set</th>
            <th>Finish</th>
            <th>Target</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {data.entries.map((e, idx) => (
            <tr key={`${e.scryfallId}-${idx}`}>
              <td>{e.quantity}</td>
              <td>{e.name}</td>
              <td>
                {e.setCode.toUpperCase()} {e.collectorNumber}
              </td>
              <td>{e.finish}</td>
              <td>{e.targetPrice != null ? `$${e.targetPrice.toFixed(2)}` : ''}</td>
              <td>{e.note ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

function SharedDeck({ data }: { data: PublicDeck }) {
  const mainCount = data.cards.length + (data.commander ? 1 : 0) + (data.partnerCommander ? 1 : 0);
  const commanderName = (card: PublicDeck['commander']) =>
    card && typeof card === 'object' && 'name' in card
      ? String((card as { name: unknown }).name)
      : '';
  return (
    <main className="shared-view">
      <SharedHeader
        ownerUsername={data.ownerUsername}
        title={data.name}
        subtitle={`${data.format} · ${mainCount.toLocaleString()} cards${data.deckGrade ? ` · ${data.deckGrade.letter}` : ''}`}
      />
      {data.commander && (
        <section className="shared-deck-commander">
          <h2>Commander</h2>
          <p>{commanderName(data.commander)}</p>
        </section>
      )}
      {data.partnerCommander && (
        <section className="shared-deck-commander">
          <h2>Partner</h2>
          <p>{commanderName(data.partnerCommander)}</p>
        </section>
      )}
      <section>
        <h2>Mainboard ({data.cards.length})</h2>
        <ul className="shared-deck-list">
          {data.cards.map((slot, idx) => {
            const c = slot.card;
            const name = typeof c.name === 'string' ? c.name : '(unknown)';
            return <li key={idx}>{name}</li>;
          })}
        </ul>
      </section>
      {data.sideboard.length > 0 && (
        <section>
          <h2>Sideboard ({data.sideboard.length})</h2>
          <ul className="shared-deck-list">
            {data.sideboard.map((slot, idx) => (
              <li key={idx}>{typeof slot.card.name === 'string' ? slot.card.name : '(unknown)'}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function CardGrid({ cards }: { cards: PublicCard[] }) {
  if (cards.length === 0) {
    return <p className="shared-empty">This collection is empty.</p>;
  }
  return (
    <ul className="shared-card-grid">
      {cards.map((c, idx) => (
        <li key={`${c.scryfallId}-${idx}`} className="shared-card">
          {c.imageNormal ? (
            <img src={c.imageNormal} alt={c.name} loading="lazy" />
          ) : (
            <div className="shared-card-placeholder">{c.name}</div>
          )}
          <div className="shared-card-meta">
            <div className="shared-card-name">{c.name}</div>
            <div className="shared-card-set">
              {c.setCode.toUpperCase()} {c.collectorNumber}
              {c.finish !== 'nonfoil' && <span className="shared-card-finish"> · {c.finish}</span>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
