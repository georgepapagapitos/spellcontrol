/**
 * /dev/catalog: every shared primitive in every meaningful state, on one page
 * (board T176 W3). It is the specimen sheet the design convergences were
 * approved from, kept in the repo, and the surface `scripts/catalog-shots.mjs`
 * photographs each night so a silent pixel change is caught.
 *
 * It ships in the production build on purpose: the nightly runs against one.
 * It costs a first-time visitor nothing (React.lazy chunk, its own stylesheet,
 * no link from any nav) and asks crawlers to stay away (a robots meta while
 * mounted, plus `Disallow: /dev/` in public/robots.txt).
 *
 * `?theme=<id>&typeset=<id>` set the real theme and type-set stores before the
 * page reports ready (`data-catalog-ready="true"`), so a script never races a
 * font load.
 *
 * Coverage against the Primitives index in STYLE_GUIDE.md. Rendered here:
 * everything in `components/shared/` that stands alone, plus Tabs and
 * SelectMenu. Skipped, each with its reason, in `catalog-coverage.test.ts`'s
 * SKIPPED list (a shrink-only ratchet): popover and dialog shells that need an
 * anchor or a portal (CtxMenuShell, ToolbarPopover, ViewPopoverPanel,
 * FilterTrigger, DeckExportDialog), animated moments (SealBurst, SealMoment,
 * FoilShimmer inside a foil card only), and pieces whose data is a network or
 * a library we do not want in a screenshot (ShareQrCode, CardTable, InlineRename).
 */
import { useEffect, useState } from 'react';
import { SelectMenu } from '@/components/overlays/SelectMenu';
import { THEMES, isValidTheme } from '@/lib/account/themes';
import { TYPESETS, isValidTypeSet } from '@/lib/account/typesets';
import { useDocumentTitle } from '@/lib/util/use-document-title';
import { useThemeStore } from '@/store/theme';
import { useTypeSetStore } from '@/store/typeset';
import { CatalogSections } from './catalog/CatalogSections';
import './CatalogPage.css';

export function CatalogPage() {
  useDocumentTitle('Component catalog');
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const typeset = useTypeSetStore((s) => s.typeset);
  const setTypeSet = useTypeSetStore((s) => s.setTypeSet);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex,nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('theme');
    const s = params.get('typeset');
    if (t && isValidTheme(t)) setTheme(t);
    if (s && isValidTypeSet(s)) setTypeSet(s);
    // Fonts for a non-default set load through an injected <link>; wait for
    // them so the first crop is not taken in the fallback face.
    const settle = () => setTimeout(() => setReady(true), 50);
    void (document.fonts?.ready ?? Promise.resolve()).then(settle, settle);
  }, [setTheme, setTypeSet]);

  return (
    <main className="catalog-page" id="catalog-top" data-catalog-ready={ready ? 'true' : 'false'}>
      <header className="catalog-head">
        <h1 className="catalog-title">Component catalog</h1>
        <div className="catalog-controls">
          <SelectMenu
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={THEMES.map((t) => ({ value: t.id, label: t.name }))}
          />
          <SelectMenu
            label="Type set"
            value={typeset}
            onChange={setTypeSet}
            options={TYPESETS.map((t) => ({ value: t.id, label: t.name }))}
          />
        </div>
      </header>
      <CatalogSections />
    </main>
  );
}
