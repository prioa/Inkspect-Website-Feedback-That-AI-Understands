/**
 * Renders the Chrome Web Store graphics (store/src/*.svg) as JPEGs into
 * store/. The target size is part of the file name (…-1280x800.svg).
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const srcDir = new URL('../store/src/', import.meta.url);
const outDir = new URL('../store/', import.meta.url);

const files = (await readdir(srcDir)).filter((f) => f.endsWith('.svg')).sort();

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', pipe: true });
try {
  const page = await browser.newPage();
  for (const file of files) {
    const svg = await readFile(new URL(file, srcDir), 'utf8');
    const match = /-(\d+)x(\d+)\.svg$/.exec(file);
    if (!match) {
      console.warn(`skip ${file}: Groesse fehlt im Dateinamen`);
      continue;
    }
    const [w, h] = [Number(match[1]), Number(match[2])];
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.setContent(
      `<style>html,body{margin:0}svg{display:block;width:${w}px;height:${h}px}</style>${svg}`,
    );
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 92 });
    const out = file.replace(/\.svg$/, '.jpg');
    await writeFile(new URL(out, outDir), jpeg);
    console.log(`store/${out}`);
  }
} finally {
  await browser.close();
}
