// Fixture pages reproducing the dalong.net review-page markup documented in the
// handoff (section#m > .gallery-grid > a[href][data-caption], and .kit-header).
//
// NOTE: these are reconstructions of the documented structure, not captures of
// the live pages — the sandbox this was built in has no network access to
// dalong.net. If dalong.net's markup ever differs from what's here, the real
// page wins and these fixtures should be re-captured from it.

/**
 * @param {object} opts
 * @param {string} opts.prefix   kit prefix used in file names, e.g. 'fm03'
 * @param {string} opts.infix    the bit between prefix and number, 'm' or 'mb'
 * @param {string} opts.ext      file extension as it appears in the href
 * @param {number} opts.count    number of manual images
 * @param {{grade: string, code: string, name: string}} opts.kit
 * @param {string} opts.title    document title
 * @param {(i: number) => string} [opts.href] override the href for one entry
 */
export function reviewPage(opts) {
  const { prefix, infix, ext, count, kit, title } = opts;
  const anchors = [];
  for (let i = 1; i <= count; i++) {
    const num = String(i).padStart(4, '0');
    const base = `${prefix}_${infix}${num}`;
    const href = opts.href ? opts.href(i) : `p/${base}${ext}`;
    anchors.push(
      `      <a href="${href}" data-caption="Manual (${i}/${count})">\n` +
        `        <img src="th/s_${base}.jpg" alt="${kit.name} - Manual (${i}/${count})" loading="lazy">\n` +
        `      </a>`,
    );
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
</head>
<body>
<header class="kit-header">
  <div class="container">
    <div class="kit-meta">
      <span class="kit-grade">${kit.grade}</span>
      <span class="kit-code">${kit.code}</span>
    </div>
    <h1 class="kit-name">${kit.name}</h1>
  </div>
</header>

<section class="section" id="b">
  <div class="section-header"><h2 class="section-title">&#9654;Box Open</h2></div>
  <div class="gallery-grid">
    <a href="p/${prefix}_b0001${ext}" data-caption="Box Open (1/2)"><img src="th/s_${prefix}_b0001.jpg" alt="box"></a>
    <a href="p/${prefix}_b0002${ext}" data-caption="Box Open (2/2)"><img src="th/s_${prefix}_b0002.jpg" alt="box"></a>
  </div>
</section>

<section class="section" id="m">
  <div class="section-header">
    <h2 class="section-title">&#9654;Manual</h2>
    <a href="#top" class="section-top-link">TOP</a>
  </div>
  <div class="gallery-grid">
${anchors.join('\n')}
  </div>
</section>
</body>
</html>
`;
}

/** Full Mechanics Gundam Barbatos Lupus Rex — 18 manual images, `m` infix. */
export const FM03 = {
  path: 'reviews/ib/fm03/fm03_i_e.htm',
  count: 18,
  prefix: 'fm03',
  infix: 'm',
  ext: '.JPG',
  kit: { grade: 'Full Mechanics', code: '', name: 'Gundam Barbatos Lupus Rex' },
  title: 'dalong.net review - Full Mechanics Gundam Barbatos Lupus Rex',
  expectedFilename: 'Full-Mechanics_Gundam-Barbatos-Lupus-Rex-manual.pdf',
};

/** MG ∀ Gundam — 20 manual images, `mb` infix, populated kit-code, non-ASCII name. */
export const MG100 = {
  path: 'reviews/mg/mg100/mg100_i_e.htm',
  count: 20,
  prefix: 'mg100',
  infix: 'mb',
  ext: '.JPG',
  kit: { grade: 'MG', code: 'WD-M01', name: '∀ Gundam' },
  title: 'dalong.net review - MG ∀ Gundam',
  expectedFilename: 'MG_WD-M01_Gundam-manual.pdf',
};

/** A review page with no Manual section at all. */
export const NO_MANUAL = {
  path: 'reviews/hg/hg999/hg999_i_e.htm',
  html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>dalong.net review - HG Nothing</title></head>
<body>
<header class="kit-header"><div class="container">
  <div class="kit-meta"><span class="kit-grade">HG</span><span class="kit-code"></span></div>
  <h1 class="kit-name">Nothing Here</h1>
</div></header>
<section class="section" id="b">
  <div class="section-header"><h2 class="section-title">&#9654;Box Open</h2></div>
  <div class="gallery-grid"><a href="p/hg999_b0001.JPG" data-caption="Box Open (1/1)"><img src="th/x.jpg" alt="box"></a></div>
</section>
</body></html>
`,
};

export function htmlFor(page) {
  return page.html ?? reviewPage(page);
}

export const PAGES = [FM03, MG100, NO_MANUAL];
