# The one verification pass that needs real network access

Everything in `npm test` and `npm run test:e2e` passes, but the environment this
was built in **cannot reach dalong.net** — outbound requests to it are blocked by
the sandbox's egress proxy:

```
curl https://www.dalong.net/reviews/ib/fm03/fm03_i_e.htm
curl: (56) CONNECT tunnel failed, response 403
```

So the two live pages named in the handoff were never fetched. The fixtures in
`test/fixtures/pages.mjs` reproduce the markup *as documented in the handoff*
(`section#m > .gallery-grid > a[href][data-caption]`, `.kit-header` with
`.kit-grade` / `.kit-code` / `.kit-name`), including the awkward bits: the `m`
vs `mb` filename infix, uppercase `.JPG`, an empty `kit-code`, a non-ASCII kit
name, and a decoy `#b` "Box Open" gallery on the same page. If the live markup
turns out to differ, the live page wins — re-capture the fixtures from it and
rerun the tests.

## The quick way: one command

On a machine that can reach dalong.net, with Google Chrome installed. **The
code is on the `claude/new-session-j13n7i` branch, not `main`** — a plain
`git pull` on `main` gets you the README and nothing else:

```sh
git fetch origin claude/new-session-j13n7i
git switch claude/new-session-j13n7i
npm install
npm run test:live
```

Works the same in cmd, PowerShell and a POSIX shell.

This loads the extension into your real Chrome, runs the export against both
pages from the handoff, then re-fetches every scan straight from dalong.net and
checks the PDF against it — page count, each page's exact pixel dimensions, and
that pages 1..N really are scans 1..N in order. Expected output:

```
fm03 (Full Mechanics Barbatos Lupus Rex)
      -> 18 images, "Full Mechanics Gundam Barbatos Lupus Rex", saves as Full-Mechanics_Gundam-Barbatos-Lupus-Rex-manual.pdf
  ok  fm03 (…): the extension finds the Manual section
  ok  fm03 (…): the export completes and Chrome saves the PDF
  ok  fm03 (…): the scans really are JPEGs
  ok  fm03 (…): every page is its scan's exact pixel size
  ok  fm03 (…): pages 1..18 are the scans, in order
      saved: /tmp/dalong-live-XXXX/Full-Mechanics_Gundam-Barbatos-Lupus-Rex-manual.pdf
… same for mg100, 20 pages …

10/10 checks passed
```

`npm run test:live -- --headed` shows the browser while it works, and
`npm run test:live -- <url>` points it at any other review page. It only reads
from dalong.net; the PDFs go to a temp directory whose path it prints.

The runner's own logic was verified against the fixture site (10/10), so a
failure here means the live markup differs from the handoff — see the table at
the bottom of this file.

## The slow way: click through it yourself

Worth doing once anyway, to eyeball the actual scans. First:
`chrome://extensions` → Developer mode → **Load unpacked** → this directory.

## Test 1 — fm03 (18 images, empty kit-code)

1. Go to `https://www.dalong.net/reviews/ib/fm03/fm03_i_e.htm`.
2. Click the extension's toolbar icon.
3. **Expected popup:** `Found 18 manual images (Full Mechanics Gundam Barbatos Lupus Rex).`
   and below it `Saves as Full-Mechanics_Gundam-Barbatos-Lupus-Rex-manual.pdf`.
4. Click **Download PDF**. The status counts up (`Downloading images… 4/18`),
   then `Building the PDF…`, then
   `Saved Full-Mechanics_Gundam-Barbatos-Lupus-Rex-manual.pdf (18 pages).`
5. **Expected file:** `Full-Mechanics_Gundam-Barbatos-Lupus-Rex-manual.pdf` in
   your downloads folder, **18 pages**, where
   page 1 = the content of `p/fm03_m0001.JPG`,
   page 2 = `p/fm03_m0002.JPG`, …,
   page 18 = `p/fm03_m0018.JPG`.
   Each page should be the full scan — not cropped, not stretched, no white
   margin around it.

## Test 2 — mg100 (20 images, `mb` infix, populated kit-code, `∀` in the name)

1. Go to `https://www.dalong.net/reviews/mg/mg100/mg100_i_e.htm`.
2. Click the icon.
3. **Expected popup:** `Found 20 manual images (MG WD-M01 ∀ Gundam).` and
   `Saves as MG_WD-M01_Gundam-manual.pdf`.
4. Click **Download PDF**.
5. **Expected file:** `MG_WD-M01_Gundam-manual.pdf`, **20 pages**, page 1 =
   `p/mg100_mb0001.JPG` … page 20 = `p/mg100_mb0020.JPG`.

## Test 3 — a page with no Manual section


1. Go to any dalong.net page that has no `Manual` section (e.g. a review's main
   `_e.htm` page rather than its `_i_e.htm` info page).
2. Click the icon.
3. **Expected popup:** `No Manual section found on this page.` in red, with no
   download button.

## Test 4 — not dalong.net

1. Go to any other site.
2. Click the icon.
3. **Expected popup:** `This only works on www.dalong.net review pages.`

## If something differs

The most likely divergences, and where to look:

| Symptom | Where |
| --- | --- |
| "No Manual section found" on a page that has one | the `section#m .gallery-grid` selector in `src/scrape.js` |
| Wrong page count, or pages out of order | `data-caption` format — `parseCaption` in `src/manual.js` |
| Wrong filename | `.kit-header` selectors in `src/scrape.js`, `buildFilename` in `src/manual.js` |
| "Could not download image N … HTTP 403" | the images need referer/cookies; the fetch is in `fetchImages` in `src/pdf.js` |
| "… is not a JPEG or PNG" | some scans aren't JPEG after all; `magicKind` in `src/pdf.js` |

A copy of the failing page's HTML (`view-source:` → save) is enough to turn any
of these into a fixture and a fix.
