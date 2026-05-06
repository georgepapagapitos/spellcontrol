/**
 * Attribution footer. Scryfall asks consumers of their API to display a notice indicating
 * that card data comes from them; this is the cheapest way to honor that. Also disclaims
 * affiliation with Wizards of the Coast.
 */
export function Footer() {
  return (
    <footer className="footer">
      <p>
        Card data from{' '}
        <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer">
          Scryfall
        </a>
        . Import your collection from ManaBox, Moxfield, Archidekt, Deckbox, or any compatible CSV.
      </p>
      <p className="footer-fineprint">
        This tool is unofficial and not affiliated with, endorsed, sponsored, or specifically
        approved by Wizards of the Coast LLC or Scryfall. Magic: The Gathering and all related
        assets are the property of Wizards of the Coast.
      </p>
      <p className="footer-fineprint">
        Your binder configurations and uploaded collection are stored locally in your browser. They
        are not synced across devices.
      </p>
    </footer>
  );
}
