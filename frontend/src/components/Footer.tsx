/**
 * Attribution footer. Scryfall asks API consumers to display a notice that card data
 * comes from them; this is the cheapest way to honor that.
 */
export function Footer() {
  return (
    <footer className="footer">
      <p className="footer-fineprint">
        Card data from{' '}
        <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer">
          Scryfall
        </a>
        . Stored locally in your browser.
      </p>
    </footer>
  );
}
