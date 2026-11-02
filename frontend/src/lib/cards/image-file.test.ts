import { describe, expect, it } from 'vitest';
import { cardImageFilename, imageExtension, imageMimeType } from './image-file';

describe('card image file naming', () => {
  it('reads the extension off the URL path, ignoring the stamp', () => {
    expect(imageExtension('https://cards.scryfall.io/display/front/a/b/ab.webp?1790743605')).toBe(
      'webp'
    );
    expect(imageExtension('https://x/y.png')).toBe('png');
    expect(imageExtension('https://x/y.jpeg?1')).toBe('jpg');
    expect(imageExtension('https://x/y.jpg')).toBe('jpg');
  });

  it('falls back to JPEG for a URL with no image extension', () => {
    expect(imageExtension(undefined)).toBe('jpg');
    expect(imageExtension('https://x/y')).toBe('jpg');
  });

  it('pairs each extension with its MIME type', () => {
    expect(imageMimeType('https://x/y.webp')).toBe('image/webp');
    expect(imageMimeType('https://x/y.png')).toBe('image/png');
    expect(imageMimeType('https://x/y.jpg')).toBe('image/jpeg');
  });

  it('builds a slug filename', () => {
    expect(cardImageFilename("Atraxa, Praetors' Voice", 'https://x/y.webp')).toBe(
      'atraxa-praetors-voice.webp'
    );
  });
});
