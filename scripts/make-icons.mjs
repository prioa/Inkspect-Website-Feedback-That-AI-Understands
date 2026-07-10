/** Rendert assets/icon.svg in die PNG-Groessen des Manifests (public/icon/). */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SIZES = [16, 32, 48, 96, 128];

const svg = await readFile(new URL('../assets/icon.svg', import.meta.url), 'utf8');
const outDir = new URL('../public/icon/', import.meta.url);
await mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', pipe: true });
try {
  const page = await browser.newPage();
  for (const size of SIZES) {
    await page.setViewport({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    const png = await page.screenshot({ omitBackground: true });
    await writeFile(new URL(`${size}.png`, outDir), png);
    console.log(`public/icon/${size}.png`);
  }
} finally {
  await browser.close();
}
