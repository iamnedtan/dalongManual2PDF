// End-to-end run of the extension in a real browser against a local stand-in for
// www.dalong.net (see site.mjs). Chromium is pointed at the fixture server with
// --host-resolver-rules, so the extension runs on genuine
// https://www.dalong.net/... URLs under its real host_permissions.
//
// This proves the pipeline (scrape -> fetch -> PDF -> chrome.downloads) against
// the markup as documented in the handoff. For the real site, see test/live.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildSite, serve, imageSize, FM03, MG100, H59, NO_MANUAL } from './site.mjs';
import { PDFLib } from '../load-pdf-lib.mjs';
import { embedOffsets, exportFrom, launchWithExtension, makeReporter } from '../harness.mjs';

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'dalong-e2e-'));
const SITE = path.join(WORK, 'site');
const { step, summarize } = makeReporter();

async function main() {
  console.log('building fixture site…');
  await buildSite(SITE);
  const { server, port } = await serve(SITE, path.join(WORK, 'cert'));
  console.log(`serving https://www.dalong.net -> 127.0.0.1:${port}`);

  const browser = await launchWithExtension({
    profileDir: path.join(WORK, 'profile'),
    downloadsDir: path.join(WORK, 'downloads'),
    channel: 'chromium',
    args: [
      `--host-resolver-rules=MAP www.dalong.net 127.0.0.1:${port}`,
      '--ignore-certificate-errors',
      // CI sandboxes export HTTP(S)_PROXY; the stand-in dalong.net is local
      '--no-proxy-server',
    ],
  });
  console.log(`extension id ${browser.extensionId}`);

  const url = (p) => `https://www.dalong.net/${p}`;

  // ---- fm03: 18 manual images -------------------------------------------
  const fm03 = await exportFrom(browser, url(FM03.path));

  await step('fm03: popup reports 18 manual images and the right filename', () => {
    assert.equal(fm03.inspect.ok, true, fm03.inspect.error);
    assert.equal(fm03.inspect.count, 18);
    assert.equal(fm03.inspect.total, 18);
    assert.equal(fm03.inspect.filename, FM03.expectedFilename);
    assert.equal(fm03.inspect.displayName, 'Full Mechanics Gundam Barbatos Lupus Rex');
  });

  await step('fm03: chrome.downloads saves the PDF under the built filename', () => {
    assert.equal(fm03.exported?.ok, true, fm03.exported?.error);
    assert.equal(fm03.exported.pageCount, 18);
    assert.equal(fm03.exported.filename, FM03.expectedFilename);
    const item = fm03.items[0];
    assert.ok(item, 'chrome.downloads recorded no download');
    assert.equal(item.state, 'complete');
    assert.equal(item.mime, 'application/pdf');
    assert.ok(fs.existsSync(item.filename), `${item.filename} missing on disk`);
    fm03.file = item.filename;
  });

  await step('fm03: PDF has 18 pages sized to the source images', async () => {
    const doc = await PDFLib.PDFDocument.load(fs.readFileSync(fm03.file));
    assert.equal(doc.getPageCount(), 18);
    doc.getPages().forEach((p, i) => {
      const { width, height } = imageSize(FM03, i);
      assert.equal(Math.round(p.getWidth()), width, `page ${i + 1} width`);
      assert.equal(Math.round(p.getHeight()), height, `page ${i + 1} height`);
    });
  });

  await step('fm03: pages carry the source scans, in order 1..18', () => {
    const pdfBytes = fs.readFileSync(fm03.file);
    const sources = Array.from({ length: 18 }, (_, i) =>
      fs.readFileSync(
        path.join(SITE, 'reviews/ib/fm03/p', `fm03_m${String(i + 1).padStart(4, '0')}.JPG`),
      ),
    );
    const offsets = embedOffsets(pdfBytes, sources);
    offsets.forEach((at, i) => assert.ok(at >= 0, `scan ${i + 1} is not embedded in the PDF`));
    assert.deepEqual(
      offsets,
      [...offsets].sort((a, b) => a - b),
      'embedded scans are not in page order',
    );
  });

  // ---- mg100: 20 images, `mb` infix, non-ASCII kit name ------------------
  const mg100 = await exportFrom(browser, url(MG100.path));

  await step('mg100: 20 images, mb-infixed hrefs, transliterated filename', async () => {
    assert.equal(mg100.inspect.ok, true, mg100.inspect.error);
    assert.equal(mg100.inspect.count, 20);
    assert.equal(mg100.inspect.filename, MG100.expectedFilename);
    assert.equal(mg100.exported?.ok, true, mg100.exported?.error);
    assert.equal(mg100.exported.filename, MG100.expectedFilename);
    const item = mg100.items[0];
    assert.equal(item.state, 'complete');
    const doc = await PDFLib.PDFDocument.load(fs.readFileSync(item.filename));
    assert.equal(doc.getPageCount(), 20);
  });

  // ---- h59: Manual section with id `cm` instead of `m` --------------------
  const h59 = await exportFrom(browser, url(H59.path));

  await step('h59: finds a Manual section whose id is cm', async () => {
    assert.equal(h59.inspect.ok, true, h59.inspect.error);
    assert.equal(h59.inspect.count, 8);
    assert.equal(h59.inspect.filename, H59.expectedFilename);
    assert.equal(h59.exported?.ok, true, h59.exported?.error);
    const doc = await PDFLib.PDFDocument.load(fs.readFileSync(h59.items[0].filename));
    assert.equal(doc.getPageCount(), 8);
  });

  // ---- a page with no Manual section -------------------------------------
  const none = await exportFrom(browser, url(NO_MANUAL.path));

  await step('a page without a Manual section reports it instead of exporting', () => {
    assert.equal(none.inspect.ok, false);
    assert.match(none.inspect.error, /No Manual section found/);
  });

  // ---- the popup's own rendering -----------------------------------------
  const { context, extensionId, page } = browser;

  async function openPopupBehind(pageUrl) {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    await popup.reload(); // re-run init now that the review page is the active tab
    return popup;
  }

  await step('popup renders the found-images message on a manual page', async () => {
    const popup = await openPopupBehind(url(FM03.path));
    await popup.waitForFunction(() => !document.getElementById('export').hidden, undefined, {
      timeout: 10000,
    });
    assert.equal(
      await popup.textContent('#status'),
      'Found 18 manual images (Full Mechanics Gundam Barbatos Lupus Rex).',
    );
    assert.equal(await popup.textContent('#note'), `Saves as ${FM03.expectedFilename}`);
    await popup.close();
  });

  await step('popup refuses on a non-dalong page', async () => {
    const popup = await openPopupBehind('about:blank');
    await popup.waitForFunction(
      () => document.getElementById('status').classList.contains('error'),
      undefined,
      { timeout: 10000 },
    );
    assert.match(await popup.textContent('#status'), /only works on www\.dalong\.net/);
    await popup.close();
  });

  await context.close();
  server.close();

  if (!summarize()) process.exit(1);
  fs.rmSync(WORK, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
