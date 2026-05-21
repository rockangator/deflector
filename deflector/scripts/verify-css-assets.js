/** Fail build if manifest/popup CSS paths are missing (catches broken @import migrations). */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function assertExists(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing asset: ${rel}`);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const cssFromManifest = manifest.content_scripts?.[0]?.css ?? [];
for (const file of cssFromManifest) assertExists(file);

const popupHtml = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const linkRe = /<link rel="stylesheet" href="([^"]+)" \/>/g;
let match;
while ((match = linkRe.exec(popupHtml)) !== null) {
  assertExists(match[1]);
}

const requiredAssets = [
  'src/ui/assets/logo-mark.png',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
];
for (const file of requiredAssets) assertExists(file);

console.log('CSS and icon assets OK');
