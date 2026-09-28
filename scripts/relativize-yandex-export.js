const fs = require('fs');
const path = require('path');

// Static export directory produced by `next build` when NEXT_PUBLIC_PLATFORM is yandex.
const outDir = path.join(__dirname, '..', 'out');

// Collect every file under `dir` into `files`.
function walk(dir, files) {
  // Directory entries, files and nested folders.
  const names = fs.readdirSync(dir);
  for (const name of names) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, files);
    else files.push(full);
  }
}

// Prefix that walks from this file's folder back to `out/`, so `/_next/` can become a relative URL.
function relativePrefix(file) {
  // Path from out/ to the file's directory. Empty when the file sits next to index.html.
  const rel = path.relative(outDir, path.dirname(file));
  if (!rel) return './';
  return '../'.repeat(rel.split(path.sep).length);
}

// Rewrite root-absolute `/_next/` URLs. `/sdk.js` stays absolute so Yandex can serve the SDK.
function rewrite(file) {
  // Only text assets contain URL strings. Fonts and icons are left untouched.
  const ext = path.extname(file);
  if (ext !== '.html' && ext !== '.js' && ext !== '.css' && ext !== '.txt') return;
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('/_next/')) return;
  // CSS urls are resolved from the stylesheet, which lives in `_next/static/css/`.
  let next = text;
  if (ext === '.css') {
    next = text.replace(/url\(\/_next\/static\//g, 'url(../');
  } else if (ext === '.js') {
    // Webpack publicPath is applied against the document, so `./_next/` follows index.html.
    next = text.replace(/\/_next\//g, './_next/');
  } else {
    const prefix = relativePrefix(file);
    next = text.replace(/\/_next\//g, `${prefix}_next/`);
  }
  if (next !== text) fs.writeFileSync(file, next);
}

// Every exported file that may point at `/_next/`.
const files = [];
walk(outDir, files);
files.forEach(rewrite);
