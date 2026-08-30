// End-to-end run of the packed extension in a real Chromium against a local
// stand-in for www.dalong.net (see site.mjs). Verifies the whole pipeline:
// scrape -> fetch -> PDF -> chrome.downloads, and checks the saved PDF's page
// count, page sizes and page order against the source JPEGs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildSite, serve, imageSize, FM03, MG100, NO_MANUAL } from './site.mjs';
import { PDFLib } from '../load-pdf-lib.mjs';

const EXT_DIR = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'dalong-e2e-'));
const SITE = path.join(WORK, 'site');

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push([true, name]);
    console.log(`  ok  ${name}`);
  } catch (error) {
    results.push([false, name]);
    console.log(`FAIL  ${name}\n      ${error.stack.split('\n').slice(0, 4).join('\n      ')}`);
  }
}

/** Where does each source JPEG's byte stream first appear in the PDF? */
function embedOrder(pdfBytes, sourceFiles) {
  return sourceFiles.map((file) => {
    const needle = fs.readFileSync(file);
    // pdf-lib stores an embedded JPEG verbatim, minus the leading SOI marker in
    // some builds, so match on a distinctive slice from the middle of the file.
    const probe = needle.subarray(Math.floor(needle.length / 2), Math.floor(needle.length / 2) + 64);
    return { file, at: pdfBytes.indexOf(probe) };
  });
}

async function main() {
  console.log('building fixture site…');
  await buildSite(SITE);
  const { server, port } = await serve(SITE, path.join(WORK, 'cert'));
  console.log(`serving https://www.dalong.net -> 127.0.0.1:${port}`);

  const profile = path.join(WORK, 'profile');
  const downloads = path.join(WORK, 'downloads');
  fs.mkdirSync(downloads, { recursive: true });
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
  fs.writeFileSync(
    path.join(profile, 'Default', 'Preferences'),
    JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false } }),
  );

  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    ignoreHTTPSErrors: true,
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      `--host-resolver-rules=MAP www.dalong.net 127.0.0.1:${port}`,
      '--ignore-certificate-errors',
      // the sandbox this runs in exports HTTP(S)_PROXY; the fake dalong.net is local
      '--no-proxy-server',
    ],
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extensionId = new URL(worker.url()).host;
  console.log(`extension id ${extensionId}`);

  const page = await context.newPage();

  // Playwright's harness takes over download naming (files land under a GUID in
  // its own directory), so this only redirects them somewhere the test can clean
  // up. The name the extension asked chrome.downloads for is checked through the
  // service worker's reply and the popup instead.
  const cdp = await context.browser().newBrowserCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });

  /** Drive the export the way the popup does, from a real extension page. */
  async function exportFrom(url) {
    await page.goto(`https://www.dalong.net/${url}`, { waitUntil: 'domcontentloaded' });
    const helper = await context.newPage();
    await helper.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    const tabId = await helper.evaluate(
      async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
    );
    const inspect = await helper.evaluate(
      (id) => chrome.runtime.sendMessage({ target: 'background', type: 'inspect', tabId: id }),
      tabId,
    );
    const exported = inspect.ok
      ? await helper.evaluate(
          (id) => chrome.runtime.sendMessage({ target: 'background', type: 'startExport', tabId: id }),
          tabId,
        )
      : null;
    const items = await helper.evaluate(() =>
      chrome.downloads.search({ limit: 10, orderBy: ['-startTime'] }),
    );
    await helper.close();
    return { inspect, exported, items };
  }

  // ---- fm03: 18 manual images -------------------------------------------
  const fm03 = await exportFrom(FM03.path);

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
      path.join(SITE, 'reviews/ib/fm03/p', `fm03_m${String(i + 1).padStart(4, '0')}.JPG`),
    );
    const found = embedOrder(pdfBytes, sources);
    for (const { file, at } of found) {
      assert.ok(at >= 0, `${path.basename(file)} is not embedded in the PDF`);
    }
    const offsets = found.map((f) => f.at);
    assert.deepEqual(
      offsets,
      [...offsets].sort((a, b) => a - b),
      'embedded scans are not in page order',
    );
  });

  // ---- mg100: 20 images, `mb` infix, non-ASCII kit name ------------------
  const mg100 = await exportFrom(MG100.path);

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

  // ---- a page with no Manual section -------------------------------------
  const none = await exportFrom(NO_MANUAL.path);

  await step('a page without a Manual section reports it instead of exporting', () => {
    assert.equal(none.inspect.ok, false);
    assert.match(none.inspect.error, /No Manual section found/);
  });

  // ---- the popup's own rendering -----------------------------------------
  await step('popup renders the found-images message on a manual page', async () => {
    await page.goto(`https://www.dalong.net/${FM03.path}`, { waitUntil: 'domcontentloaded' });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    await popup.reload();
    await popup.waitForFunction(
      () => !document.getElementById('export').hidden,
      undefined,
      { timeout: 10000 },
    );
    assert.equal(
      await popup.textContent('#status'),
      'Found 18 manual images (Full Mechanics Gundam Barbatos Lupus Rex).',
    );
    assert.equal(await popup.textContent('#note'), `Saves as ${FM03.expectedFilename}`);
    await popup.close();
  });

  await step('popup refuses on a non-dalong page', async () => {
    await page.goto('https://www.dalong.net/nope.htm').catch(() => {});
    await page.goto('about:blank');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    await popup.reload();
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

  const failed = results.filter(([ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
  fs.rmSync(WORK, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
