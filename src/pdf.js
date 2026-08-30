// PDF assembly. Depends on pdf-lib being available as the `PDFLib` global
// (vendor/pdf-lib.min.js is a UMD build, so this module also works under Node's
// CommonJS `require` in the tests via the same global-free entry point below).

function magicKind(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  return null;
}

/**
 * Build a PDF with one page per image, each page sized to that image's pixel
 * dimensions so nothing is cropped or rescaled.
 *
 * @param {{PDFDocument: any}} pdfLib the pdf-lib module/global
 * @param {Array<{bytes: Uint8Array, label?: string}>} images in final page order
 * @returns {Promise<Uint8Array>} the PDF bytes
 */
export async function buildPdf(pdfLib, images) {
  if (!images.length) throw new Error('No images to put in the PDF.');

  const doc = await pdfLib.PDFDocument.create();
  doc.setProducer('Dalong.net Manual to PDF');
  doc.setCreator('Dalong.net Manual to PDF');

  for (const image of images) {
    const kind = magicKind(image.bytes);
    if (!kind) {
      throw new Error(
        `${image.label || 'An image'} is not a JPEG or PNG (unrecognised file header).`,
      );
    }
    const embedded =
      kind === 'jpeg' ? await doc.embedJpg(image.bytes) : await doc.embedPng(image.bytes);
    const page = doc.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  }

  return doc.save();
}

/**
 * Fetch every image in order, reporting progress as it goes.
 * Runs a small number of requests at a time: fast enough on a 20-scan manual
 * without hammering dalong.net with 20 parallel connections.
 */
export async function fetchImages(urls, { concurrency = 4, onProgress = () => {} } = {}) {
  const results = new Array(urls.length);
  let started = 0;
  let done = 0;

  async function worker() {
    while (started < urls.length) {
      const index = started++;
      const url = urls[index];
      let response;
      try {
        response = await fetch(url, { credentials: 'omit' });
      } catch (cause) {
        throw new Error(`Could not download image ${index + 1} (${url}): ${cause.message}`);
      }
      if (!response.ok) {
        throw new Error(`Could not download image ${index + 1} (${url}): HTTP ${response.status}`);
      }
      results[index] = new Uint8Array(await response.arrayBuffer());
      onProgress(++done, urls.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()),
  );
  return results;
}
