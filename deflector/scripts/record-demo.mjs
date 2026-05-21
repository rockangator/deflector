/**
 * Records a Deflector product demo video with Playwright + loaded extension.
 * Output: docs/deflector-demo.webm (+ docs/deflector-demo.mp4 when ffmpeg available)
 *
 * Usage: npm run demo:record
 */
import { createServer } from 'http';
import { readFile, mkdir, readdir, copyFile, rm, mkdtemp } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { chromium } from 'playwright';
import { spawn } from 'child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const PREVIEW = join(ROOT, 'preview');
const OUT_DIR = join(ROOT, '..', 'docs');
const VIDEO_TMP = join(OUT_DIR, '.demo-video-tmp');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        let rel = urlPath;
        if (rel === '/') rel = '/products/wireless-headphones';
        if (rel.startsWith('/products/')) rel = '/demo.html';
        const filePath = join(PREVIEW, rel.replace(/^\//, ''));
        const data = await readFile(filePath);
        const ext = extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function convertToMp4(webmPath, mp4Path) {
  const ffmpeg = process.env.PLAYWRIGHT_FFMPEG_PATH
    || join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'ffmpeg-1011', 'ffmpeg-win64.exe');

  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, ['-y', '-i', webmPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4Path], {
      stdio: 'ignore',
    });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(VIDEO_TMP, { recursive: true });
  const userDataDir = await mkdtemp(join(tmpdir(), 'deflector-demo-'));

  const { server, port } = await startServer();
  const demoUrl = `http://127.0.0.1:${port}/products/wireless-headphones`;

  console.log('Launching Chrome with Deflector extension…');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: VIDEO_TMP, size: { width: 1280, height: 800 } },
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
    ],
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    console.log('Loading demo product page…');
    await page.goto(demoUrl, { waitUntil: 'domcontentloaded' });

    console.log('Waiting for Deflector FAB…');
    await page.waitForSelector('#deflector-fab', { timeout: 30000 });
    await page.waitForFunction(
      () => {
        const fab = document.querySelector('#deflector-fab');
        const count = document.querySelector('#deflector-fab-count');
        return fab && !fab.classList.contains('deflector-fab-scanning')
          && count && count.textContent !== '0';
      },
      { timeout: 25000 },
    );
    await sleep(1200);

    console.log('Opening findings sidebar…');
    await page.click('#deflector-fab');
    await page.waitForSelector('#deflector-sidebar.deflector-sidebar-open', { timeout: 10000 });
    await sleep(2500);

    const finding = page.locator('.deflector-finding').first();
    if (await finding.count()) {
      console.log('Selecting first finding…');
      await finding.click();
      await sleep(2200);
    }

    console.log('Opening settings…');
    await page.click('#deflector-settings-toggle');
    await sleep(1800);

    console.log('Showing extension popup…');
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = sw.url().split('/')[2];

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 380, height: 520 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await sleep(3000);

    console.log('Closing sidebar and reopening for final shot…');
    await page.bringToFront();
    await page.click('#deflector-sidebar-close');
    await sleep(1000);
    await page.click('#deflector-fab');
    await sleep(2500);
  } finally {
    await context.close();
    server.close();
    await rm(userDataDir, { recursive: true, force: true });
  }

  const files = await readdir(VIDEO_TMP);
  const webm = files.find((f) => f.endsWith('.webm'));
  if (!webm) {
    console.error('No video file recorded.');
    process.exit(1);
  }
  const destWebm = join(OUT_DIR, 'deflector-demo.webm');
  await copyFile(join(VIDEO_TMP, webm), destWebm);
  await rm(VIDEO_TMP, { recursive: true, force: true });

  const destMp4 = join(OUT_DIR, 'deflector-demo.mp4');
  const converted = await convertToMp4(destWebm, destMp4);
  if (converted) {
    console.log(`Demo video saved: ${destMp4}`);
  } else {
    console.log(`Demo video saved: ${destWebm}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
