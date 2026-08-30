// Service worker: owns the export pipeline so it survives the popup closing.
//
// Flow: popup sends `startExport` with the tab id -> we inject the scraper into
// that tab -> hand the ordered job to the offscreen document, which downloads
// the scans and builds the PDF -> we save it with chrome.downloads.

import { buildJob } from './src/manual.js';
import { scrapeManualPage } from './src/scrape.js';

const OFFSCREEN_PATH = 'offscreen.html';
const ALLOWED_HOST = 'www.dalong.net';

let offscreenReady = null;

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  if (existing.length > 0) return;

  // createDocument throws if a second call lands while the first is in flight.
  if (!offscreenReady) {
    offscreenReady = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification: 'Assemble the manual scans into a PDF and create a blob URL to save it.',
      })
      .finally(() => {
        offscreenReady = null;
      });
  }
  await offscreenReady;
}

/** Read the Manual gallery out of the given tab. Throws with a user-facing message. */
export async function scrapeTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  let host = '';
  try {
    host = new URL(tab.url || '').hostname;
  } catch {
    host = '';
  }
  if (host !== ALLOWED_HOST) {
    throw new Error('This only works on www.dalong.net review pages.');
  }

  let injection;
  try {
    [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: scrapeManualPage,
    });
  } catch (cause) {
    throw new Error(`Could not read the page: ${cause.message}`);
  }

  const scrape = injection?.result;
  if (!scrape || !scrape.found) {
    throw new Error('No Manual section found on this page.');
  }
  const job = buildJob(scrape);
  if (job.images.length === 0) {
    throw new Error('The Manual section on this page has no images.');
  }
  return job;
}

/** Wait for a started download to finish (or fail), so we can revoke the blob. */
function waitForDownload(downloadId) {
  return new Promise((resolve) => {
    const onChanged = (delta) => {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
        chrome.downloads.onChanged.removeListener(onChanged);
        resolve(delta.state.current);
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);
  });
}

/** Scrape, build and save. Returns `{ pageCount, filename }` on success. */
export async function runExport(tabId) {
  const job = await scrapeTab(tabId);

  await ensureOffscreenDocument();
  const built = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'buildPdf',
    job,
  });
  if (!built?.ok) throw new Error(built?.error || 'Building the PDF failed.');

  try {
    const downloadId = await chrome.downloads.download({
      url: built.url,
      filename: job.filename,
      saveAs: false,
    });
    const finalState = await waitForDownload(downloadId);
    if (finalState === 'interrupted') throw new Error('The download was interrupted.');
  } finally {
    await chrome.runtime
      .sendMessage({ target: 'offscreen', type: 'releaseBlob', url: built.url })
      .catch(() => {});
    await chrome.offscreen.closeDocument().catch(() => {});
  }

  return { pageCount: built.pageCount, filename: job.filename, byteLength: built.byteLength };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'background') return undefined;

  if (message.type === 'inspect') {
    scrapeTab(message.tabId).then(
      (job) =>
        sendResponse({
          ok: true,
          count: job.images.length,
          total: job.total,
          filename: job.filename,
          displayName: job.displayName,
        }),
      (error) => sendResponse({ ok: false, error: error.message }),
    );
    return true;
  }

  if (message.type === 'startExport') {
    runExport(message.tabId).then(
      (result) => sendResponse({ ok: true, ...result }),
      (error) => sendResponse({ ok: false, error: error.message }),
    );
    return true;
  }

  return undefined;
});
