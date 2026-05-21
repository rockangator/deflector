/**
 * Self-hosts Imbue typography (Caslon Ionic + ABC Diatype Semi Mono) from
 * public assets on imbue.com — same faces used on https://imbue.com/
 * Falls back to @fontsource packages if download fails.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'ui', 'fonts');

/** @type {[string, string][]} */
const IMBUE_FONTS = [
  ['https://imbue.com/_astro/fonts/f9c34e2fa853ae5d.woff2', 'caslon-ionic-400.woff2'],
  ['https://imbue.com/_astro/fonts/3cf5ee4503a54e6c.woff2', 'abc-semi-mono-400.woff2'],
  ['https://imbue.com/_astro/fonts/0c0ef9552f438986.woff2', 'abc-semi-mono-500.woff2'],
  ['https://imbue.com/_astro/fonts/a009603ac1991489.woff2', 'abc-semi-mono-700.woff2'],
];

/** @type {[string, string][]} */
const FALLBACK_FONTS = [
  ['@fontsource/libre-caslon-text/files/libre-caslon-text-latin-400-normal.woff2', 'caslon-ionic-400.woff2'],
  ['@fontsource/dm-mono/files/dm-mono-latin-400-normal.woff2', 'abc-semi-mono-400.woff2'],
  ['@fontsource/dm-mono/files/dm-mono-latin-500-normal.woff2', 'abc-semi-mono-500.woff2'],
  ['@fontsource/dm-mono/files/dm-mono-latin-500-normal.woff2', 'abc-semi-mono-700.woff2'],
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        download(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let usedFallback = false;

  for (const [url, destName] of IMBUE_FONTS) {
    const dest = path.join(OUT, destName);
    try {
      await download(url, dest);
      console.log(`Wrote ${dest} (imbue.com)`);
    } catch (err) {
      console.warn(`Imbue download failed for ${destName}: ${err.message}`);
      usedFallback = true;
      break;
    }
  }

  if (usedFallback) {
    console.warn('Using open-source fallback fonts (Libre Caslon Text + DM Mono)');
    for (const [srcRel, destName] of FALLBACK_FONTS) {
      const src = path.join(ROOT, 'node_modules', srcRel);
      const dest = path.join(OUT, destName);
      if (!fs.existsSync(src)) {
        console.error(`Missing fallback: ${srcRel} — run npm install`);
        process.exit(1);
      }
      fs.copyFileSync(src, dest);
      console.log(`Wrote ${dest} (fallback)`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
