// The function below is serialized and injected into the dalong.net tab by
// chrome.scripting.executeScript, so it must be entirely self-contained: no
// imports, no closure variables, only page globals. It does DOM reading and
// nothing else — parsing, ordering and naming live in src/manual.js so they can
// be tested without a browser.

/**
 * Scrape the Manual gallery out of a dalong.net review page.
 * Returns `{ found: false }` when the page has no Manual section, otherwise
 * `{ found: true, entries, kit, title }` with hrefs already absolute.
 */
export function scrapeManualPage() {
  // Most pages id the Manual section `m`; some (e.g. HGUC h59) use `cm`.
  const gallery = document.querySelector('section#m .gallery-grid, section#cm .gallery-grid');
  if (!gallery) return { found: false };

  const entries = [];
  for (const anchor of gallery.querySelectorAll('a[href]')) {
    entries.push({
      href: new URL(anchor.getAttribute('href'), document.baseURI).href,
      caption: anchor.getAttribute('data-caption') || '',
    });
  }

  const text = (selector) => {
    const el = document.querySelector(selector);
    return el ? el.textContent.trim() : '';
  };

  return {
    found: true,
    entries,
    kit: {
      grade: text('.kit-header .kit-grade'),
      code: text('.kit-header .kit-code'),
      name: text('.kit-header .kit-name'),
    },
    title: document.title || '',
  };
}
