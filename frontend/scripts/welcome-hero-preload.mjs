// The welcome hero's art, preloaded from the initial HTML (E1105).
//
// The hero card is picked per day (lib/home/welcome-hero.ts) and its art URL
// used to be resolved by an API lookup after the app booted, so the browser
// found the page's LCP image seconds late. index.html now carries a tiny
// inline script, injected at build by the vite plugin in vite.config.ts, that
// makes the same pick from a static name -> art URL table
// (src/lib/home/welcome-hero-art.json) and adds `<link rel=preload as=image>`
// before any module script runs. WelcomeHero renders that same URL.
//
// Keep the pick below in step with pickWelcomeHeroCard: welcome-hero-preload
// .test.ts evaluates this script against it over a year of days.

/** Same key lib/home/first-run.ts reads: a device past first-run never sees `/`. */
const EVER_VISITED_KEY = 'sc-ever-visited-app';

/** Inline script text for `names` (the pool, in picker order) and `art` (name -> URL). */
export function welcomeHeroPreloadScript(names, art) {
  const urls = names.map((n) => {
    if (!art[n]) throw new Error(`welcome-hero-art.json has no URL for "${n}"`);
    return art[n];
  });
  return `(function () {
  try {
    var p = location.pathname;
    if ((p !== '/' && p !== '/welcome') || localStorage.getItem(${JSON.stringify(EVER_VISITED_KEY)}) !== null) return;
    var u = ${JSON.stringify(urls)};
    var d = new Date();
    var l = document.createElement('link');
    l.rel = 'preload';
    l.as = 'image';
    l.href = u[Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000) % u.length];
    l.setAttribute('fetchpriority', 'high');
    document.head.appendChild(l);
  } catch (e) {}
})();`;
}
