// Shared plumbing for the two browser runs: test/e2e (fixture stand-in for
// dalong.net) and test/live (the real site). Neither needs any test-only change
// to the extension — both load it unpacked and drive it the way the popup does.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const EXT_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Tiny pass/fail reporter — a full test runner would only get in the way here. */
export function makeReporter() {
  const results = [];
  return {
    async step(name, fn) {
      try {
        await fn();
        results.push(true);
        console.log(`  ok  ${name}`);
      } catch (error) {
        results.push(false);
        console.log(`FAIL  ${name}\n      ${error.stack.split('\n').slice(0, 4).join('\n      ')}`);
      }
    },
    summarize() {
      const passed = results.filter(Boolean).length;
      console.log(`\n${passed}/${results.length} checks passed`);
      return passed === results.length;
    },
  };
}

/**
 * Launch a browser with the extension loaded unpacked.
 *
 * @param {object} opts
 * @param {string} opts.profileDir   throwaway user-data dir
 * @param {string} opts.downloadsDir where saved files should land
 * @param {string} [opts.channel]    'chrome' for the user's installed Chrome
 * @param {boolean} [opts.headless]
 * @param {string[]} [opts.args]     extra Chrome flags
 */
export async function launchWithExtension(opts) {
  const { profileDir, downloadsDir, channel, headless = true, args = [] } = opts;
  fs.mkdirSync(downloadsDir, { recursive: true });
  fs.mkdirSync(path.join(profileDir, 'Default'), { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, 'Default', 'Preferences'),
    JSON.stringify({ download: { default_directory: downloadsDir, prompt_for_download: false } }),
  );

  const context = await chromium.launchPersistentContext(profileDir, {
    channel,
    headless,
    ignoreHTTPSErrors: true,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, ...args],
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30000 });
  const extensionId = new URL(worker.url()).host;

  const page = await context.newPage();

  // Playwright's harness takes over download naming (files land under a GUID),
  // so this only puts them somewhere known. The name the extension asked
  // chrome.downloads for is checked through the service worker's reply instead.
  const cdp = await context.browser().newBrowserCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadsDir });

  return { context, extensionId, page };
}

/**
 * Drive one export exactly as the popup does: open the page, then talk to the
 * service worker from a real extension page whose window's active tab is that
 * page. Returns the worker's `inspect` and `startExport` replies plus what
 * chrome.downloads recorded.
 */
export async function exportFrom({ context, extensionId, page }, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
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

/**
 * Where does each source image's byte stream first appear in the PDF?
 * pdf-lib embeds a JPEG verbatim, so a slice from the middle of the file is a
 * reliable probe, and ascending offsets mean the pages are in source order.
 */
export function embedOffsets(pdfBytes, sources) {
  return sources.map((bytes) => {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const mid = Math.floor(buf.length / 2);
    return pdfBytes.indexOf(buf.subarray(mid, mid + 64));
  });
}

/** Read a baseline/progressive JPEG's pixel dimensions out of its SOF marker. */
export function jpegSize(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let i = 2; // skip SOI
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    // SOF0..SOF15, excluding the non-frame markers DHT (c4), JPG (c8) and DAC (cc)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('no JPEG frame header found');
}
