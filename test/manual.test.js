import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFilename,
  buildJob,
  claimedTotal,
  displayName,
  FALLBACK_FILENAME,
  orderImages,
  parseCaption,
  sanitizeField,
} from '../src/manual.js';
import { buildPdf } from '../src/pdf.js';
import { FM03, MG100 } from './fixtures/pages.mjs';
import { PDFLib } from './load-pdf-lib.mjs';

test('parseCaption reads the page number and total', () => {
  assert.deepEqual(parseCaption('Manual (1/18)'), { pageNum: 1, total: 18 });
  assert.deepEqual(parseCaption('Manual (18/18)'), { pageNum: 18, total: 18 });
  assert.deepEqual(parseCaption('Manual (7 / 20)'), { pageNum: 7, total: 20 });
  assert.equal(parseCaption('Manual'), null);
  assert.equal(parseCaption(''), null);
  assert.equal(parseCaption(undefined), null);
});

test('orderImages sorts by caption number, not DOM order', () => {
  const entries = [
    { href: 'c', caption: 'Manual (3/3)' },
    { href: 'a', caption: 'Manual (1/3)' },
    { href: 'b', caption: 'Manual (2/3)' },
  ];
  assert.deepEqual(
    orderImages(entries).map((i) => i.href),
    ['a', 'b', 'c'],
  );
});

test('orderImages keeps 10+ in numeric, not lexicographic, order', () => {
  const entries = Array.from({ length: 18 }, (_, i) => ({
    href: `p/fm03_m${String(i + 1).padStart(4, '0')}.JPG`,
    caption: `Manual (${i + 1}/18)`,
  }));
  assert.deepEqual(
    orderImages(entries).map((i) => i.pageNum),
    Array.from({ length: 18 }, (_, i) => i + 1),
  );
});

test('orderImages keeps unparseable captions in DOM position instead of dropping them', () => {
  const entries = [
    { href: 'a', caption: 'Manual (1/3)' },
    { href: 'mystery', caption: '' },
    { href: 'c', caption: 'Manual (3/3)' },
  ];
  const ordered = orderImages(entries);
  assert.deepEqual(
    ordered.map((i) => i.href),
    ['a', 'mystery', 'c'],
  );
  assert.equal(ordered[1].pageNum, null);
});

test('claimedTotal reports the total the captions agree on', () => {
  assert.equal(claimedTotal(orderImages([{ href: 'a', caption: 'Manual (1/18)' }])), 18);
  assert.equal(claimedTotal(orderImages([{ href: 'a', caption: 'nope' }])), null);
});

test('sanitizeField keeps filenames ASCII-safe', () => {
  assert.equal(sanitizeField('Full Mechanics'), 'Full-Mechanics');
  assert.equal(sanitizeField('  MG  '), 'MG');
  assert.equal(sanitizeField('WD-M01'), 'WD-M01');
  assert.equal(sanitizeField('∀ Gundam'), 'Gundam');
  assert.equal(sanitizeField('Hi-ν Gundam'), 'Hi-Gundam');
  assert.equal(sanitizeField('ガンダム'), '');
  assert.equal(sanitizeField(''), '');
  assert.equal(sanitizeField(undefined), '');
  assert.match(sanitizeField('a/b\\c:d*e?f"g<h>i|j'), /^[A-Za-z0-9._+-]+$/);
});

test('buildFilename matches the worked examples from the two verified pages', () => {
  assert.equal(buildFilename(FM03.kit), FM03.expectedFilename);
  assert.equal(buildFilename(MG100.kit), MG100.expectedFilename);
});

test('buildFilename skips an empty kit-code without leaving a double underscore', () => {
  const name = buildFilename({ grade: 'HG', code: '   ', name: 'Zaku II' });
  assert.equal(name, 'HG_Zaku-II-manual.pdf');
  assert.ok(!name.includes('__'));
});

test('buildFilename falls back rather than failing the export', () => {
  assert.equal(buildFilename({}), FALLBACK_FILENAME);
  assert.equal(buildFilename(null), FALLBACK_FILENAME);
  assert.equal(buildFilename({ grade: 'ガンダム', code: '', name: '∀' }), FALLBACK_FILENAME);
});

test('displayName keeps the original characters for the popup', () => {
  assert.equal(displayName(MG100.kit, MG100.title), 'MG WD-M01 ∀ Gundam');
  assert.equal(displayName({}, 'dalong.net review'), 'dalong.net review');
  assert.equal(displayName({}, ''), 'this page');
});

test('buildJob turns a scrape into an ordered, named job', () => {
  const job = buildJob({
    entries: [
      { href: 'https://www.dalong.net/reviews/ib/fm03/p/fm03_m0002.JPG', caption: 'Manual (2/2)' },
      { href: 'https://www.dalong.net/reviews/ib/fm03/p/fm03_m0001.JPG', caption: 'Manual (1/2)' },
    ],
    kit: FM03.kit,
    title: FM03.title,
  });
  assert.deepEqual(
    job.images.map((i) => i.pageNum),
    [1, 2],
  );
  assert.equal(job.total, 2);
  assert.equal(job.filename, FM03.expectedFilename);
});

// --- PDF assembly -----------------------------------------------------------

/** Smallest valid JPEG/PNG-ish bytes are awkward to hand-write, so build real
 *  ones with pdf-lib's own embedders in reverse: use fixed known files. */
function jpegBytes(width, height) {
  // Minimal baseline JPEG: SOI, APP0, DQT, SOF0 (carries the dimensions), and a
  // stub scan. pdf-lib only reads the SOF0 header for width/height.
  const header = [
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0/JFIF
    0xff, 0xc0, 0x00, 0x11, 0x08, // SOF0, length 17, 8-bit
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, // 3 components
    0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9, // EOI
  ];
  return new Uint8Array(header);
}

test('buildPdf gives one page per image, sized to that image in pixels', async () => {
  const sizes = [
    [800, 1130],
    [1200, 900],
    [640, 480],
  ];
  const bytes = await buildPdf(
    PDFLib,
    sizes.map(([w, h]) => ({ bytes: jpegBytes(w, h) })),
  );

  const doc = await PDFLib.PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), sizes.length);
  doc.getPages().forEach((page, i) => {
    assert.equal(Math.round(page.getWidth()), sizes[i][0]);
    assert.equal(Math.round(page.getHeight()), sizes[i][1]);
  });
});

test('buildPdf rejects a file that is not a JPEG or PNG', async () => {
  await assert.rejects(
    () => buildPdf(PDFLib, [{ bytes: new Uint8Array([0x3c, 0x21, 0x44, 0x4f]), label: 'Page 1' }]),
    /Page 1 is not a JPEG or PNG/,
  );
});

test('buildPdf refuses to make an empty PDF', async () => {
  await assert.rejects(() => buildPdf(PDFLib, []), /No images/);
});
