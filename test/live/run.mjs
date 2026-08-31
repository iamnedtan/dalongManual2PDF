// The verification pass this project could not run where it was built: drives
// the extension in your real, installed Google Chrome against the live
// www.dalong.net, and checks the PDFs it produces against the actual scans.
//
//   npm run test:live               # headless Chrome
//   HEADED=1 npm run test:live      # watch it happen
//   npm run test:live -- <url>...   # check other review pages instead
//   CHANNEL=chromium npm run test:live   # use a Playwright build instead of Chrome
//
// Unlike test/e2e this needs working network access to dalong.net. It reads the
// live pages and images but writes nothing back — the PDFs land in a temp
// directory, whose path is printed at the end so you can open them.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PDFLib } from '../load-pdf-lib.mjs';
import {
  embedOffsets,
  exportFrom,
  jpegSize,
  launchWithExtension,
  makeReporter,
} from '../harness.mjs';

const DEFAULT_PAGES = [
  {
    url: 'https://www.dalong.net/reviews/ib/fm03/fm03_i_e.htm',
    label: 'fm03 (Full Mechanics Barbatos Lupus Rex)',
    expect: { count: 18, filename: 'Full-Mechanics_Gundam-Barbatos-Lupus-Rex-manual.pdf' },
  },
  {
    url: 'https://www.dalong.net/reviews/mg/mg100/mg100_i_e.htm',
    label: 'mg100 (MG ∀ Gundam)',
    expect: { count: 20, filename: 'MG_WD-M01_Gundam-manual.pdf' },
  },
];

const argUrls = process.argv.slice(2).filter((a) => a.startsWith('http'));
const PAGES = argUrls.length
  ? argUrls.map((url) => ({ url, label: url, expect: {} }))
  : DEFAULT_PAGES;

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'dalong-live-'));
const { step, summarize } = makeReporter();

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} -> HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const headed = process.env.HEADED === '1';
  let browser;
  try {
    browser = await launchWithExtension({
      profileDir: path.join(WORK, 'profile'),
      downloadsDir: path.join(WORK, 'downloads'),
      // your installed Google Chrome, not a Playwright build
      channel: process.env.CHANNEL || 'chrome',
      headless: !headed,
    });
  } catch (error) {
    console.error(
      `Could not launch Google Chrome: ${error.message}\n` +
        'Install Chrome, or run with a Playwright build instead:\n' +
        '  npx playwright install chromium && CHANNEL=chromium npm run test:live',
    );
    process.exit(1);
  }
  console.log(`extension id ${browser.extensionId}\n`);

  for (const target of PAGES) {
    console.log(target.label);
    const run = await exportFrom(browser, target.url);

    await step(`${target.label}: the extension finds the Manual section`, () => {
      assert.equal(run.inspect.ok, true, run.inspect.error);
      assert.ok(run.inspect.count > 0, 'found zero images');
      if (target.expect.count) assert.equal(run.inspect.count, target.expect.count);
      if (target.expect.filename) assert.equal(run.inspect.filename, target.expect.filename);
      console.log(
        `      -> ${run.inspect.count} images, "${run.inspect.displayName}", ` +
          `saves as ${run.inspect.filename}`,
      );
    });

    if (!run.inspect.ok) continue;

    await step(`${target.label}: the export completes and Chrome saves the PDF`, () => {
      assert.equal(run.exported?.ok, true, run.exported?.error);
      assert.equal(run.exported.pageCount, run.inspect.count);
      const item = run.items[0];
      assert.ok(item, 'chrome.downloads recorded no download');
      assert.equal(item.state, 'complete');
      assert.equal(item.mime, 'application/pdf');
      run.file = item.filename;
      console.log(`      -> ${(run.exported.byteLength / 1e6).toFixed(1)} MB`);
    });

    if (!run.file) continue;

    // Re-fetch the scans straight from dalong.net and compare them to the PDF —
    // the extension's own view of the page isn't used for this check.
    const hrefs = await browser.page.evaluate(() =>
      [...document.querySelectorAll('section#m .gallery-grid a[href]')].map(
        (a) => new URL(a.getAttribute('href'), document.baseURI).href,
      ),
    );
    const scans = [];
    for (const href of hrefs) scans.push(await fetchBytes(href));

    await step(`${target.label}: the scans really are JPEGs`, () => {
      scans.forEach((bytes, i) => {
        assert.ok(
          bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
          `${hrefs[i]} is not a JPEG (starts ${bytes.subarray(0, 4).toString('hex')})`,
        );
      });
    });

    await step(`${target.label}: every page is its scan's exact pixel size`, async () => {
      const doc = await PDFLib.PDFDocument.load(fs.readFileSync(run.file));
      assert.equal(doc.getPageCount(), scans.length);
      doc.getPages().forEach((page, i) => {
        const { width, height } = jpegSize(scans[i]);
        assert.equal(Math.round(page.getWidth()), width, `page ${i + 1} width`);
        assert.equal(Math.round(page.getHeight()), height, `page ${i + 1} height`);
      });
    });

    await step(`${target.label}: pages 1..${scans.length} are the scans, in order`, () => {
      const pdfBytes = fs.readFileSync(run.file);
      const offsets = embedOffsets(pdfBytes, scans);
      offsets.forEach((at, i) =>
        assert.ok(at >= 0, `${path.basename(hrefs[i])} is not embedded in the PDF`),
      );
      assert.deepEqual(
        offsets,
        [...offsets].sort((a, b) => a - b),
        'embedded scans are not in page order',
      );
    });

    const keep = path.join(WORK, run.exported.filename);
    fs.copyFileSync(run.file, keep);
    console.log(`      saved: ${keep}\n`);
  }

  await browser.context.close();

  const ok = summarize();
  console.log(`\nPDFs kept in ${WORK} — open them to eyeball the scans.`);
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
