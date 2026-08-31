# Dalong.net Manual to PDF

A Manifest V3 Chrome extension. On a dalong.net review page, it exports that
page's **Manual** section — the run of instruction-manual scans — as a single
PDF, one scan per page, in the original order.

Scope is deliberately narrow: dalong.net only, Manual section only. There is no
pattern detection or gallery heuristic; it targets `section#m .gallery-grid`
directly.

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → pick this directory.

Nothing needs building; `vendor/pdf-lib.min.js` is checked in.

## Use

1. Open a dalong.net review page with a Manual section, e.g.
   `https://www.dalong.net/reviews/ib/fm03/fm03_i_e.htm`.
2. Click the toolbar icon. The popup says how many manual images it found and
   what the file will be called.
3. Click **Download PDF**. The scans are fetched, assembled and saved. The work
   runs in the background, so closing the popup doesn't cancel it.

If the page has no Manual section, the popup says
"No Manual section found on this page." and offers nothing else.

### Output filename

Built from the page's `.kit-header` fields — grade, code (skipped when empty)
and name — joined with `_`, spaces within a field turned into `-`, non-ASCII
characters dropped or transliterated, then `-manual.pdf`:

| grade | code | name | filename |
| --- | --- | --- | --- |
| `Full Mechanics` | *(empty)* | `Gundam Barbatos Lupus Rex` | `Full-Mechanics_Gundam-Barbatos-Lupus-Rex-manual.pdf` |
| `MG` | `WD-M01` | `∀ Gundam` | `MG_WD-M01_Gundam-manual.pdf` |

If the header is missing or nothing usable survives sanitising, the file is
saved as `dalong-manual.pdf` rather than failing the export.

## How it works

| File | Role |
| --- | --- |
| `popup.js` | UI only: asks the service worker what's on the page, shows progress. |
| `background.js` | Service worker. Injects the scraper, drives the export, calls `chrome.downloads`. |
| `src/scrape.js` | Injected into the page by `chrome.scripting.executeScript`. Pure DOM reading — no parsing logic, so it stays serialisable and self-contained. |
| `src/manual.js` | Caption parsing, page ordering, filename building. No DOM, no `chrome.*` — this is what the unit tests exercise. |
| `src/pdf.js` | Concurrency-limited image fetching and pdf-lib page assembly. |
| `offscreen.js` | Runs the fetch + assembly in an offscreen document. |
| `vendor/pdf-lib.min.js` | pdf-lib 1.17.1 (MIT), bundled — MV3 can't load a script from a CDN. |

Two structural notes:

- **Why an offscreen document.** The PDF has to reach `chrome.downloads` as a
  blob URL, and service workers have no `URL.createObjectURL`. Doing it in the
  popup instead would mean the export dies the moment the popup loses focus. The
  offscreen document has both a blob URL and a lifetime independent of the popup.
- **Ordering.** DOM order already matches numeric order on the pages checked, but
  `orderImages()` sorts by the number in `data-caption` anyway. An entry whose
  caption doesn't parse keeps its DOM position rather than being dropped — a
  missing caption shouldn't cost you a page of the manual.

### Permissions

- `host_permissions: https://www.dalong.net/*` — nothing broader.
- `activeTab`, `scripting` — read the gallery out of the current tab on click.
- `downloads` — save the PDF.
- `offscreen` — see above.

There is no background activity: everything happens on an explicit click.

## Tests

```sh
npm install        # Playwright, for the two browser runs
npm test           # unit: caption parsing, ordering, filenames, PDF assembly
npm run test:e2e   # end-to-end against a local stand-in for dalong.net
npm run test:live  # end-to-end against the real dalong.net, in your Chrome
```

All four work on Windows, macOS and Linux.

`test:e2e` builds a local stand-in for www.dalong.net (fixture review pages plus
real JPEGs at known sizes), serves it over HTTPS, and launches Chromium with
`--host-resolver-rules=MAP www.dalong.net 127.0.0.1:<port>` and the unpacked
extension loaded. So the extension runs against genuine
`https://www.dalong.net/...` URLs under its real `host_permissions`, with no
test-only changes to the extension itself. It then checks the saved PDF's page
count, per-page dimensions and the byte-order of the embedded scans.

`test:live` does the same against the real site in your installed Google Chrome,
re-fetching each scan straight from dalong.net to compare against the PDF. It
needs network access, which the environment this was built in did not have —
**so that run has never been executed.** Everything else has.

```sh
npm run test:live -- --headed               # watch it happen
npm run test:live -- <review-page-url>...   # check other pages
```

**The fixture pages are reconstructions of the markup documented in the
handoff, not captures of the live site.** See `MANUAL-TESTING.md`.

## Non-goals

Other review sections (Box Open, Runners, Parts, Review), other sites,
heuristics for unknown markup, and anything that uploads or shares the PDF. The
output is a local download for personal reference.
