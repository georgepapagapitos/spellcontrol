import './BracketCheckerPage.css';
import '@/styles/deck-builder-analysis-panel.css';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/app-shell/PageHeader';
import { BracketBreakdown } from '@/components/deck/BracketBreakdown';
import { SelectMenu } from '@/components/overlays/SelectMenu';
import { Button } from '@/components/shared/Button';
import { SectionHeader } from '@/components/shared/SectionHeader';
import { importDeckText } from '@/lib/api';
import {
  checkPastedDeck,
  commanderOptions,
  defaultCommander,
  formatAsOf,
  GAME_CHANGERS_AS_OF,
  GAME_CHANGERS_LIST,
  mainboardOf,
  type CheckedDeck,
} from '@/lib/deck-analysis/bracket-check';
import { formatBracketLabel } from '@/lib/deck-analysis/format-bracket-label';
import { useDeckCombos } from '@/lib/deck-analysis/use-deck-combos';
import { partnerCandidatesFor } from '@/lib/import-export/deck-import-format';
import { useBuildDeckFromImport } from '@/lib/import-export/build-deck-from-import';
import type { SelectOption } from '@/lib/util/select-option';
import { userMessage } from '@/lib/util/user-error';
import { useDocumentTitle } from '@/lib/util/use-document-title';
import {
  bracketBorderline,
  bracketReasons,
} from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { hasTaggerData, loadTaggerData } from '@/deck-builder/services/tagger/client';
import type { ScryfallCard } from '@/deck-builder/types';
import type { DeckImportResponse } from '@/types/index';

/** The static page that says how the estimate is made and how it was checked. */
const METHOD_HREF = '/guides/bracket-estimator.html';

const PLACEHOLDER =
  'Commander\n1 Korvold, Fae-Cursed King\n\nDeck\n1 Sol Ring\n1 Arcane Signet\n1 Cultivate\n…';

const NO_PARTNER = '';

type Load =
  | { state: 'idle' }
  | { state: 'reading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; result: DeckImportResponse };

const FAQ: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: 'What are Commander Brackets?',
    a: 'Five levels the Commander Rules Committee uses to describe how a deck plays: Exhibition, Core, Upgraded, Optimized and cEDH. They exist so a table can agree on a level before the game, not to rank decks.',
  },
  {
    q: 'How is the bracket estimated?',
    a: 'From the cards. Game Changers, mass land denial, extra turns, early combos and a pile of stax pieces each set a minimum bracket. If nothing sets one, fast mana, tutors, a low curve, interaction and combo engines add up to a power signal that can raise the estimate.',
  },
  {
    q: 'What is a Game Changer?',
    a: 'A card the Rules Committee names as a large jump in power. Brackets 1 and 2 play none, Bracket 3 plays up to three, and Brackets 4 and 5 have no limit. The list changes, so the date it was last checked is shown below.',
  },
  {
    q: 'Is this the official bracket of my deck?',
    a: 'No. It is an estimate from the card list, and it cannot see how you play it. Your table has the last word. Each card and rule behind the number is shown so you can point at the part you disagree with.',
  },
  {
    q: 'Do I need an account?',
    a: 'No. Paste a list and read the result. Nothing is added to a deck or an account unless you choose Save to my decks.',
  },
  {
    q: 'Which list formats work?',
    a: 'Plain text with one card per line, and exports from Moxfield, Archidekt, Deckbox, ManaBox and Magic Arena. Put the commander under a Commander header, or pick it after the list is read.',
  },
];

/**
 * `/bracket`: the public Commander bracket checker (E1090). A visitor with no
 * account pastes a decklist, confirms the commander and reads the same estimate
 * and evidence the deck's Power tab gives, plus the Game Changers list with the
 * date it was last checked. The card lookup is the import endpoint the deck
 * import uses, and the combo match is the public `/api/combos/match`, so the
 * page adds no endpoint of its own. The tag data behind the estimate loads only
 * when a list is submitted, so nothing here is on the boot path.
 */
export function BracketCheckerPage() {
  useDocumentTitle('Commander bracket checker');
  const navigate = useNavigate();
  const buildDeck = useBuildDeckFromImport();

  const [text, setText] = useState('');
  const [load, setLoad] = useState<Load>({ state: 'idle' });
  const [commanderName, setCommanderName] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState<string>(NO_PARTNER);
  const [checked, setChecked] = useState<CheckedDeck | null>(null);

  const result = load.state === 'ready' ? load.result : null;

  const options = useMemo(() => (result ? commanderOptions(result) : []), [result]);
  const commander = options.find((c) => c.name === commanderName) ?? null;
  const partnerOptions = useMemo(
    () => (result ? partnerCandidatesFor(result.cards, commander) : []),
    [result, commander]
  );
  const partner = partnerOptions.find((c) => c.name === partnerName) ?? null;

  const mainboard = useMemo(
    () => (result && commander ? mainboardOf(result, commander, partner) : []),
    [result, commander, partner]
  );
  const commanders = useMemo(
    () => [commander, partner].filter((c): c is ScryfallCard => !!c),
    [commander, partner]
  );

  const deckOracleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of [...commanders, ...mainboard]) if (c.oracle_id) ids.add(c.oracle_id);
    return [...ids];
  }, [commanders, mainboard]);
  const noOwned = useMemo<string[]>(() => [], []);
  const comboIdentity = useMemo(
    () => [...new Set(commanders.flatMap((c) => c.color_identity ?? []))],
    [commanders]
  );
  const combos = useDeckCombos({
    deckOracleIds,
    ownedOracleIds: noOwned,
    format: 'commander',
    colorIdentity: comboIdentity,
    enabled: commander !== null,
  });

  // The estimate waits for the combo match (combos are what most often set a
  // floor). A failed match still estimates, marked as a floor.
  const waitingOnCombos = commander !== null && combos.loading;
  useEffect(() => {
    if (!commander || waitingOnCombos) return;
    let stale = false;
    void checkPastedDeck({ mainboard, commanders, combos: combos.data }).then((next) => {
      if (!stale) setChecked(next);
    });
    return () => {
      stale = true;
    };
  }, [commander, waitingOnCombos, mainboard, commanders, combos.data]);

  const read = useCallback(async () => {
    const pasted = text.trim();
    if (!pasted) return;
    setLoad({ state: 'reading' });
    setChecked(null);
    try {
      const [parsed] = await Promise.all([importDeckText(pasted), loadTaggerData()]);
      // Without the tag data every tutor, wipe and extra turn reads as absent
      // and the number comes out quietly low, so it is an error, not a guess.
      if (!hasTaggerData()) throw new Error("Couldn't load the card data. Try again.");
      setCommanderName(defaultCommander(parsed)?.name ?? null);
      setPartnerName(NO_PARTNER);
      setLoad({ state: 'ready', result: parsed });
    } catch (err) {
      setLoad({
        state: 'error',
        message: userMessage(err, "Couldn't read that list. Check it and try again."),
      });
    }
  }, [text]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void read();
  };

  const saveDeck = () => {
    if (!result || !commander) return;
    // Private: a visitor saving to look at it later has not agreed to publish.
    const id = buildDeck(result, commander, commander.name, 'commander', {
      partner,
      initialVisibility: 'private',
    });
    navigate(`/decks/${id}`);
  };

  const commanderChoices: SelectOption<string>[] = options.map((c) => ({
    value: c.name,
    label: c.name,
  }));
  const partnerChoices: SelectOption<string>[] = [
    { value: NO_PARTNER, label: 'No partner' },
    ...partnerOptions.map((c) => ({ value: c.name, label: c.name })),
  ];

  const estimation = checked?.estimation ?? null;
  const reading = load.state === 'reading';
  const deckCardsByName = useMemo(
    () => new Map<string, ScryfallCard>([...mainboard, ...commanders].map((c) => [c.name, c])),
    [mainboard, commanders]
  );
  const cardCount = mainboard.length + commanders.length;
  const asOf = formatAsOf(GAME_CHANGERS_AS_OF);
  const inDeck = new Set(checked?.gameChangers ?? []);

  return (
    <div className="bracket-check">
      <PageHeader
        title="Commander bracket checker"
        meta="Paste a decklist to see which bracket it reads as, and why. No account needed."
      />

      <form className="bracket-check-form" onSubmit={onSubmit}>
        <label className="bracket-check-label" htmlFor="bracket-check-list">
          Decklist
        </label>
        <textarea
          id="bracket-check-list"
          className="paste-textarea bracket-check-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          disabled={reading}
          aria-describedby="bracket-check-hint"
          spellCheck={false}
        />
        <p id="bracket-check-hint" className="bracket-check-hint">
          One card per line, or an export from Moxfield, Archidekt, Deckbox, ManaBox or Arena.
        </p>
        <div className="bracket-check-actions">
          <Button type="submit" variant="primary" disabled={reading || !text.trim()}>
            {reading ? 'Reading your list' : 'Check bracket'}
          </Button>
        </div>
      </form>

      {reading && (
        <div className="bracket-check-status" role="status" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          Reading your list
        </div>
      )}

      {load.state === 'error' && (
        <div className="bracket-check-error" role="alert">
          <span>{load.message}</span>
          <Button onClick={() => void read()}>Retry</Button>
        </div>
      )}

      {result && (
        <section className="bracket-check-result" aria-labelledby="bracket-check-result-title">
          <SectionHeader title="Your estimate" id="bracket-check-result-title" />

          {(result.unresolvedNames.length > 0 || result.fetchErrors.length > 0) && (
            <div className="bracket-check-note" role="status">
              {result.unresolvedNames.length > 0 && (
                <p>
                  {result.unresolvedNames.length} card
                  {result.unresolvedNames.length === 1 ? '' : 's'} couldn&apos;t be found and{' '}
                  {result.unresolvedNames.length === 1 ? 'is' : 'are'} left out:{' '}
                  {result.unresolvedNames.slice(0, 8).join(', ')}
                  {result.unresolvedNames.length > 8 ? '…' : ''}
                </p>
              )}
              {result.fetchErrors.length > 0 && (
                <p>
                  {result.fetchErrors.length} card{result.fetchErrors.length === 1 ? '' : 's'}{' '}
                  couldn&apos;t be looked up right now.{' '}
                  <Button variant="link" onClick={() => void read()}>
                    Read the list again
                  </Button>
                </p>
              )}
            </div>
          )}

          <div className="bracket-check-pickers">
            {options.length > 0 ? (
              <SelectMenu<string>
                label="Commander"
                ariaLabel="Commander"
                value={commanderName ?? ''}
                placeholder="Pick a commander"
                options={commanderChoices}
                onChange={(name) => {
                  setCommanderName(name);
                  setPartnerName(NO_PARTNER);
                  setChecked(null);
                }}
              />
            ) : (
              <p className="bracket-check-note">
                No legendary creature in this list. Put the commander under a Commander header and
                check again.
              </p>
            )}
            {commander && partnerOptions.length > 0 && (
              <SelectMenu<string>
                label="Partner"
                ariaLabel="Partner"
                value={partnerName}
                options={partnerChoices}
                onChange={(name) => {
                  setPartnerName(name);
                  setChecked(null);
                }}
              />
            )}
          </div>

          {commander && !estimation && (
            <div className="bracket-check-status" role="status" aria-busy="true">
              <span className="spinner" aria-hidden="true" />
              Checking combos
            </div>
          )}

          {commander && estimation && (
            <>
              <div className="bracket-check-hero">
                <p className="bracket-check-hero-label">
                  {combos.error ? 'At least' : 'Estimated'}
                </p>
                <p className="bracket-check-hero-bracket">
                  {formatBracketLabel(estimation.bracket)}
                </p>
                <ul className="bracket-check-reasons">
                  {bracketReasons(estimation)
                    .slice(0, 3)
                    .map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  {bracketReasons(estimation).length === 0 && (
                    <li>Nothing in the list pushes it past Core.</li>
                  )}
                </ul>
                {bracketBorderline(estimation) !== null && (
                  <p className="bracket-check-borderline">
                    Borderline: close to Bracket {bracketBorderline(estimation)}.
                  </p>
                )}
                <p className="bracket-check-count">
                  {cardCount} card{cardCount === 1 ? '' : 's'} read
                  {cardCount !== 100 && '. A Commander deck is 100.'}
                </p>
                {combos.error && (
                  <p className="bracket-check-combo-error" role="alert">
                    {combos.error}{' '}
                    <Button variant="link" onClick={combos.refetch}>
                      Retry combos
                    </Button>
                  </p>
                )}
                <div className="bracket-check-hero-actions">
                  <Button onClick={saveDeck}>Save to my decks</Button>
                </div>
              </div>

              <BracketBreakdown
                estimation={estimation}
                deckCardsByName={deckCardsByName}
                combosUncounted={combos.error !== null}
              />
            </>
          )}
        </section>
      )}

      <section className="bracket-check-section" aria-labelledby="bracket-check-gc-title">
        <SectionHeader title="Game Changers" id="bracket-check-gc-title" />
        <p className="bracket-check-lead">
          {GAME_CHANGERS_LIST.length} cards. Last checked against the Rules Committee&apos;s list on{' '}
          {asOf}.{' '}
          {checked && (
            <>
              {inDeck.size === 0
                ? 'None are in your list.'
                : `${inDeck.size} ${inDeck.size === 1 ? 'is' : 'are'} in your list.`}
            </>
          )}
        </p>
        <ul className="bracket-check-gc">
          {GAME_CHANGERS_LIST.map((name) => (
            <li key={name} className={inDeck.has(name) ? 'is-in-deck' : undefined}>
              {name}
              {inDeck.has(name) && <span className="bracket-check-gc-mark"> (in your list)</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="bracket-check-section" aria-labelledby="bracket-check-faq-title">
        <SectionHeader title="Questions" id="bracket-check-faq-title" />
        <div className="bracket-check-faq">
          {FAQ.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
        <p className="bracket-check-lead">
          <a href={METHOD_HREF}>How the estimate is made and checked</a>
        </p>
      </section>
    </div>
  );
}
