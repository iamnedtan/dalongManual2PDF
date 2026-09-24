// Builds a local stand-in for www.dalong.net: the fixture review pages plus real
// JPEGs at known dimensions, served over HTTPS with a throwaway certificate.
// Chromium is pointed at it with --host-resolver-rules, so the extension runs
// against genuine https://www.dalong.net/... URLs and its real host_permissions.

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { FM03, MG100, H59, NO_MANUAL, REVIEW_PAGE, PAGES, htmlFor } from '../fixtures/pages.mjs';

/** Page N of a manual gets its own size so page order is checkable from the PDF. */
export function imageSize(page, index) {
  return { width: 700 + index * 3, height: 990 + ((index * 7) % 11) };
}

async function renderJpegs(specs) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    return await page.evaluate(async (items) => {
      const out = [];
      for (const item of items) {
        const canvas = document.createElement('canvas');
        canvas.width = item.width;
        canvas.height = item.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Noise so no two pages compress to identical bytes.
        ctx.fillStyle = '#c8d4e8';
        for (let i = 0; i < 60; i++) {
          const x = (i * 977 + item.seed * 131) % canvas.width;
          const y = (i * 613 + item.seed * 271) % canvas.height;
          ctx.fillRect(x, y, 40, 24);
        }
        ctx.fillStyle = '#111';
        ctx.font = 'bold 120px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.label, canvas.width / 2, canvas.height / 2);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        out.push({ name: item.name, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) });
      }
      return out;
    }, specs);
  } finally {
    await browser.close();
  }
}

/** Write the fixture site (pages + images) into `root`. */
export async function buildSite(root) {
  fs.rmSync(root, { recursive: true, force: true });

  const specs = [];
  for (const page of PAGES) {
    const dir = path.join(root, path.dirname(page.path));
    fs.mkdirSync(path.join(dir, 'p'), { recursive: true });
    fs.writeFileSync(path.join(root, page.path), htmlFor(page), 'utf8');
    if (!page.count) continue;
    for (let i = 1; i <= page.count; i++) {
      const { width, height } = imageSize(page, i - 1);
      specs.push({
        name: path.join(dir, 'p', `${page.prefix}_${page.infix}${String(i).padStart(4, '0')}${page.ext}`),
        width,
        height,
        seed: i + page.prefix.length * 17,
        label: `${page.prefix} ${i}/${page.count}`,
      });
    }
  }

  for (const { name, base64 } of await renderJpegs(specs)) {
    fs.writeFileSync(name, Buffer.from(base64, 'base64'));
  }
  return { root, specs };
}

function makeCert(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', cert, '-days', '2',
      '-subj', '/CN=www.dalong.net',
      '-addext', 'subjectAltName=DNS:www.dalong.net',
    ], { stdio: 'ignore' });
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

const TYPES = { '.htm': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.JPG': 'image/jpeg' };

/** Serve `root` over HTTPS on an ephemeral port. */
export async function serve(root, certDir) {
  const server = https.createServer(makeCert(certDir), (req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'https://www.dalong.net').pathname).replace(/^\/+/, '');
    const file = path.join(root, rel);
    if (!file.startsWith(path.resolve(root)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

export { FM03, MG100, H59, NO_MANUAL, REVIEW_PAGE };
