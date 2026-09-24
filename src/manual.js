// Pure logic for turning a raw dalong.net page scrape into an ordered manual
// image list and an output filename. No DOM, no chrome.* — unit-testable in Node.

/**
 * Parse a `data-caption` value of the form `Manual (3/18)`.
 * Returns `{ pageNum, total }`, or null if the caption isn't in that form.
 */
export function parseCaption(caption) {
  if (typeof caption !== 'string') return null;
  const m = /\((\d+)\s*\/\s*(\d+)\)/.exec(caption);
  if (!m) return null;
  const pageNum = Number(m[1]);
  const total = Number(m[2]);
  if (!pageNum || !total) return null;
  return { pageNum, total };
}

/**
 * Order the raw `{ href, caption }` entries scraped from `section#m .gallery-grid`.
 *
 * DOM order already matches numeric order on every page checked, but we sort by
 * the caption number anyway so an out-of-order page can't produce a scrambled PDF.
 * Entries whose caption doesn't parse keep their DOM position rather than being
 * dropped — a missing caption shouldn't cost the user a manual page.
 */
export function orderImages(entries) {
  const decorated = entries.map((entry, index) => {
    const parsed = parseCaption(entry.caption);
    return {
      index,
      href: entry.href,
      caption: entry.caption,
      pageNum: parsed ? parsed.pageNum : null,
      total: parsed ? parsed.total : null,
    };
  });

  decorated.sort((a, b) => {
    if (a.pageNum !== null && b.pageNum !== null && a.pageNum !== b.pageNum) {
      return a.pageNum - b.pageNum;
    }
    return a.index - b.index;
  });

  return decorated.map(({ href, caption, pageNum, total }) => ({
    href,
    caption,
    pageNum,
    total,
  }));
}

/**
 * The `total` the page claims, taken from the captions (they all agree in
 * practice). Null when no caption parsed.
 */
export function claimedTotal(images) {
  for (const image of images) {
    if (image.total !== null) return image.total;
  }
  return null;
}

const TRANSLITERATIONS = new Map([
  ['×', 'x'],
  ['＋', '+'],
  ['–', '-'],
  ['—', '-'],
  ['‐', '-'],
  ['−', '-'],
]);

/**
 * Make one kit-header field filesystem-safe: spaces become hyphens, a few known
 * non-ASCII characters are transliterated, and anything else outside
 * `[A-Za-z0-9._+-]` is dropped. Returns '' when nothing usable survives.
 */
export function sanitizeField(value) {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value.trim()) {
    if (TRANSLITERATIONS.has(ch)) {
      out += TRANSLITERATIONS.get(ch);
    } else if (/[A-Za-z0-9._+-]/.test(ch)) {
      out += ch;
    } else if (/\s/.test(ch)) {
      out += '-';
    }
    // anything else (∀ and other symbols, CJK, stray punctuation) is dropped
  }
  // collapse and trim the separators the substitutions above can pile up
  return out.replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '');
}

export const FALLBACK_FILENAME = 'dalong-manual.pdf';

/**
 * Build the output filename from the `.kit-header` fields.
 * `Full Mechanics` + `` + `Gundam Barbatos Lupus Rex`
 *   -> `Full-Mechanics_Gundam-Barbatos-Lupus-Rex-manual.pdf`
 * `MG` + `WD-M01` + `∀ Gundam`
 *   -> `MG_WD-M01_Gundam-manual.pdf` (the unmappable `∀` is dropped)
 * Falls back to `dalong-manual.pdf` when the header is missing or unusable.
 */
export function buildFilename(kit) {
  const fields = [kit?.grade, kit?.code, kit?.name]
    .map(sanitizeField)
    .filter((field) => field.length > 0);
  if (fields.length === 0) return FALLBACK_FILENAME;
  return `${fields.join('_')}-manual.pdf`;
}

/**
 * Human-readable kit name for the popup ("Found 18 manual images (…)").
 * Unlike the filename this keeps the original characters.
 */
export function displayName(kit, pageTitle) {
  const parts = [kit?.grade, kit?.code, kit?.name]
    .map((field) => (typeof field === 'string' ? field.trim() : ''))
    .filter((field) => field.length > 0);
  if (parts.length > 0) return parts.join(' ');
  return typeof pageTitle === 'string' && pageTitle.trim() ? pageTitle.trim() : 'this page';
}

/**
 * A kit's Review page (`h193_p_e.htm`, or `h193_p.htm` in Japanese) has no
 * Manual section; that lives on its Information page (`h193_i_e.htm`).
 * Returns the Information page URL for a Review page URL, otherwise null.
 */
export function informationPageUrl(pageUrl) {
  let url;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  const m = /^(.*\/[^/]+_)p((?:_[a-z]+)?\.html?)$/i.exec(url.pathname);
  if (!m) return null;
  return `${url.origin}${m[1]}i${m[2]}`;
}

/** Turn a raw page scrape into everything the export needs. */
export function buildJob(scrape) {
  const images = orderImages(scrape.entries || []);
  return {
    images,
    total: claimedTotal(images),
    filename: buildFilename(scrape.kit),
    displayName: displayName(scrape.kit, scrape.title),
  };
}
