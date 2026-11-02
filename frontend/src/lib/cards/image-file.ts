/**
 * The file extension and MIME type of a card image URL. Scryfall serves WebP
 * from 2027-01-01 (E1088), so a shared or downloaded card image must not be
 * labelled `.jpg` / `image/jpeg` by assumption. Unknown URLs read as JPEG.
 */

const TYPES = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
} as const;

type Ext = keyof typeof TYPES;

export function imageExtension(url: string | undefined): Ext {
  const m = /\.(webp|png|jpe?g)(?:[?#]|$)/i.exec(url ?? '');
  const ext = m?.[1].toLowerCase();
  return ext === 'webp' || ext === 'png' ? ext : 'jpg';
}

export function imageMimeType(url: string | undefined): string {
  return TYPES[imageExtension(url)];
}

/** `sol-ring.webp`: a download name for a card image at `url`. */
export function cardImageFilename(name: string, url: string | undefined): string {
  return `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${imageExtension(url)}`;
}
