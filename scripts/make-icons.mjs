/**
 * Renders the icon SVGs into the PNG sizes the manifest asks for
 * (public/icon/). At 16 and 32 px the simplified glyph (icon-small.svg) is
 * used — the detailed variant is no longer legible in the browser bar.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const small = await readFile(new URL('../assets/icon-small.svg', import.meta.url), 'utf8');
const large = await readFile(new URL('../assets/icon.svg', import.meta.url), 'utf8');
const VARIANTS = [
  [16, small],
  [32, small],
  [48, large],
  [96, large],
  [128, large],
];

const outDir = new URL('../public/icon/', import.meta.url);
await mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', pipe: true });
try {
  const page = await browser.newPage();
  for (const [size, svg] of VARIANTS) {
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
