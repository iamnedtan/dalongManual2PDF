// Load the vendored pdf-lib exactly as offscreen.html does — as a plain script
// that installs a `PDFLib` global — so the tests exercise the file that ships,
// not a separately resolved copy from node_modules.

import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const source = fs.readFileSync(
  fileURLToPath(new URL('../vendor/pdf-lib.min.js', import.meta.url)),
  'utf8',
);

// Run it in this realm rather than a fresh vm context: a new context has its own
// Uint8Array, and typed arrays handed across realms fail pdf-lib's instanceof
// checks. The UMD wrapper binds to `this`, which is globalThis here, so it
// installs the same `PDFLib` global the browser gets.
vm.runInThisContext(source, { filename: 'vendor/pdf-lib.min.js' });

export const PDFLib = globalThis.PDFLib;
