// Offscreen document: downloads the manual scans and assembles the PDF.
//
// This work lives here rather than in the popup so that closing the popup
// mid-export doesn't kill it, and rather than in the service worker because
// service workers have no URL.createObjectURL — and a blob URL is what
// chrome.downloads.download needs for a file this size.

import { buildPdf, fetchImages } from './src/pdf.js';

const liveBlobUrls = new Set();

function report(stage, detail) {
  // Nobody is listening when the popup is closed; that's fine.
  chrome.runtime.sendMessage({ type: 'progress', stage, ...detail }).catch(() => {});
}

async function buildPdfBlobUrl(job) {
  report('fetching', { done: 0, total: job.images.length });

  const bytesList = await fetchImages(
    job.images.map((image) => image.href),
    {
      onProgress: (done, total) => report('fetching', { done, total }),
    },
  );

  report('assembling', { done: job.images.length, total: job.images.length });

  const pdfBytes = await buildPdf(
    PDFLib,
    bytesList.map((bytes, index) => ({
      bytes,
      label: `Manual page ${job.images[index].pageNum ?? index + 1}`,
    })),
  );

  const url = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
  liveBlobUrls.add(url);
  return { url, pageCount: job.images.length, byteLength: pdfBytes.length };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return undefined;

  if (message.type === 'buildPdf') {
    buildPdfBlobUrl(message.job).then(
      (result) => sendResponse({ ok: true, ...result }),
      (error) => sendResponse({ ok: false, error: error.message }),
    );
    return true; // keep the message channel open for the async reply
  }

  if (message.type === 'releaseBlob') {
    if (liveBlobUrls.delete(message.url)) URL.revokeObjectURL(message.url);
    sendResponse({ ok: true });
    return false;
  }

  return undefined;
});
