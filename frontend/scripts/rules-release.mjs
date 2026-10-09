// Release-awareness for refresh-rules.mjs. WotC dates every Comprehensive Rules
// .txt (MagicCompRules 20260925.txt), so "is the committed bundle the current
// release" is a comparison of two URLs, not an age. The 30-day age gate alone
// left the /rules reference on the August release for ~7 weeks after the
// September one was published (board E338): the weekly run found the bundle
// "fresh" and never looked at what WotC had posted.

/** A CR URL reduced to its release stamp, or null when it carries none. */
export function releaseStamp(url) {
  if (typeof url !== 'string') return null;
  const m = decodeURIComponent(url).match(/MagicCompRules\s*(\d{8})\.txt/i);
  return m ? m[1] : null;
}

/**
 * True when WotC's published release is newer than the one the committed bundle
 * was built from. A stamp we cannot read on either side is not "newer": the age
 * gate stays the fallback, so a changed URL scheme cannot trigger refetches.
 */
export function isNewerRelease(discoveredUrl, committedSource) {
  const found = releaseStamp(discoveredUrl);
  const have = releaseStamp(committedSource);
  return found !== null && have !== null && found > have;
}
