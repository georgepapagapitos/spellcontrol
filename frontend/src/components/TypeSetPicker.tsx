import { useEffect } from 'react';
import { TYPESETS } from '../lib/typesets';
import { useTypeSetStore } from '../store/typeset';

/**
 * Radio grid for choosing a type set. Visual twin of the theme picker in
 * YouPage — it reuses the `.settings-theme-*` classes wholesale so the two
 * pickers stay one control, with only the swatch replaced by a live specimen.
 *
 * Each tile carries its own `data-typeset`, and styles/typesets.css scopes the
 * four font tokens by that attribute rather than to :root — so a tile renders
 * in its own set's faces without duplicating any font stack here.
 */
export function TypeSetPicker() {
  const typeset = useTypeSetStore((s) => s.typeset);
  const setTypeSet = useTypeSetStore((s) => s.setTypeSet);

  // A set's webfonts are normally only downloaded while it's active, so the
  // unselected tiles would preview in the fallback face — i.e. the picker
  // would lie about what you're choosing. Pull every set's stylesheet in once
  // the picker is on screen; they stay for the life of the document, which is
  // fine because this only ever mounts on Settings.
  useEffect(() => {
    const added = TYPESETS.filter((t) => t.href).map((t) => {
      const id = `sc-typeset-preview-${t.id}`;
      let link = document.getElementById(id) as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = t.href as string;
        document.head.appendChild(link);
      }
      return link;
    });
    // Deliberately not removed on unmount: re-opening Settings would re-request
    // them, and a font already in the document costs nothing to keep.
    void added;
  }, []);

  return (
    <fieldset className="settings-theme-grid" aria-label="Choose typeface">
      {TYPESETS.map((t) => (
        <label
          key={t.id}
          data-typeset={t.id}
          className={`settings-theme-option settings-typeset-option${
            t.id === typeset ? ' is-active' : ''
          }`}
        >
          <input
            type="radio"
            name="typeset"
            value={t.id}
            checked={t.id === typeset}
            onChange={() => setTypeSet(t.id)}
            className="settings-theme-radio"
          />
          <span className="settings-theme-swatch settings-typeset-swatch" aria-hidden="true">
            Aa
          </span>
          <span className="settings-theme-name settings-typeset-name">{t.name}</span>
          <span className="settings-theme-guild settings-typeset-hint">{t.hint}</span>
        </label>
      ))}
    </fieldset>
  );
}
