import type { SelectOption } from '@/components/overlays/SelectMenu';

/**
 * The per-copy condition and language vocabularies, shared by every surface
 * that shows or picks them (the add picker, the edit dialog, card rows, the
 * preview, the symbol key). A leaf module so none of them has to import
 * another component to read a label.
 */

/** '' means "not set" — the field is left off the stored copy. */
export const CONDITION_OPTIONS: SelectOption<string>[] = [
  { value: '', label: 'Not set' },
  { value: 'nm', label: 'Near Mint' },
  { value: 'lp', label: 'Lightly Played' },
  { value: 'mp', label: 'Moderately Played' },
  { value: 'hp', label: 'Heavily Played' },
  { value: 'damaged', label: 'Damaged' },
];

/** Scryfall printed-language codes. '' means "not set". */
export const LANGUAGE_OPTIONS: SelectOption<string>[] = [
  { value: '', label: 'Not set' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'ru', label: 'Russian' },
  { value: 'zhs', label: 'Chinese (Simplified)' },
  { value: 'zht', label: 'Chinese (Traditional)' },
  { value: 'ph', label: 'Phyrexian' },
];
