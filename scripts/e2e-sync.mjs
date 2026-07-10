/**
 * E2E-Verifikation des Inkspect-Syncs mit echtem Chrome:
 * Scroll, Klick (auch in Shadow DOM), Eingabe und Hover (JS + CSS :hover)
 * in Frame 1 muessen in den anderen Frames ankommen; der Kommentar-Pin
 * muss sein Notiz-Popup oeffnen. CDP-Input erzeugt isTrusted=true.
 */
import http from 'node:http';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EXT = '/Users/philippdubsky/devviwer-chrome-addon/.output/chrome-mv3';

const PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; height: 4000px; font: 16px sans-serif; position: relative; }
  #menu { display: none; }
  body.menu-open #menu { display: block; }
  #hoverBox:hover { background: rgb(255, 0, 0) !important; }
</style></head>
<body>
  <button id="menuBtn" style="position:absolute;top:0;left:0;width:300px;height:60px">Menu</button>
  <input id="name" style="position:absolute;top:70px;left:0;width:300px;height:40px">
  <div id="hoverBox" style="position:absolute;top:120px;left:0;width:300px;height:60px;background:#ddd">hover me</div>
  <div id="hoverState" style="position:absolute;top:190px;left:0">no-hover</div>
  <div id="shadowHost" style="position:absolute;top:220px;left:0;width:300px;height:60px"></div>
  <div id="shadowState" style="position:absolute;top:290px;left:0">shadow-no</div>
  <div id="menu" style="position:absolute;top:320px;left:0">MENU OPEN</div>
  <a id="link" href="/sub" style="position:absolute;top:380px;left:0;width:200px;height:30px">Weiter</a>
  <script>
    document.getElementById('menuBtn').addEventListener('click', () => {
      document.body.classList.toggle('menu-open');
    });
    document.getElementById('hoverBox').addEventListener('mouseover', () => {
      document.getElementById('hoverState').textContent = 'hovered';
    });
    const sr = document.getElementById('shadowHost').attachShadow({ mode: 'open' });
    sr.innerHTML = '<button id="inner" style="width:100%;height:100%">shadow btn</button>';
    sr.getElementById('inner').addEventListener('click', () => {
      document.getElementById('shadowState').textContent = 'shadow-clicked';
    });
  </script>
</body></html>`;

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  // /sub antwortet verzoegert — so ist der Ladebalken beobachtbar.
  const delay = req.url === '/sub' ? 600 : 0;
  setTimeout(() => res.end(PAGE_HTML), delay);
});
await new Promise((r) => server.listen(8973, r));

// Chrome >= 137 (Stable-Branding) ignoriert --load-extension; der
// unterstuetzte Weg ist installExtension() ueber die Debugging-Pipe.
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  pipe: true,
  enableExtensions: true,
  defaultViewport: { width: 1600, height: 1000 },
});
await browser.installExtension(EXT);

const results = [];
const check = (name, ok, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);

try {
  const page = await browser.newPage();
  await page.goto('http://localhost:8973/', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800)); // document_idle des Content-Scripts

  // Inkspect oeffnen (SW-unabhaengiger Toggle-Event)
  await page.evaluate(() => window.dispatchEvent(new Event('inkspect:toggle')));
  await page.waitForFunction(
    () => document.getElementById('inkspect-root')?.shadowRoot?.querySelectorAll('iframe').length >= 2,
    { timeout: 5000 },
  );

  // Warten bis alle Frames geladen sind
  await page.waitForFunction(() => {
    const frames = document.getElementById('inkspect-root').shadowRoot.querySelectorAll('iframe');
    return [...frames].every((f) => {
      try { return f.contentDocument?.readyState === 'complete' && f.contentDocument.body; }
      catch { return false; }
    });
  }, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 500));

  const frameInfo = await page.evaluate(() => {
    const frames = [...document.getElementById('inkspect-root').shadowRoot.querySelectorAll('iframe')];
    return frames.map((f) => {
      const r = f.getBoundingClientRect();
      return { left: r.left, top: r.top, scale: r.width / f.width };
    });
  });
  check('Default-Devices (iPhone SE + Laptop)', frameInfo.length === 2, `${frameInfo.length} frames`);

  const f0 = frameInfo[0];
  const inFrame0 = (x, y) => ({ x: f0.left + x * f0.scale, y: f0.top + y * f0.scale });

  const readAll = (expr) =>
    page.evaluate((e) => {
      const frames = [...document.getElementById('inkspect-root').shadowRoot.querySelectorAll('iframe')];
      return frames.map((f) => {
        try { return new Function('doc', `return ${e}`)(f.contentDocument); }
        catch { return null; }
      });
    }, expr);

  // --- 1. Scroll-Sync: Wheel ueber Frame 1 ---
  const mid = inFrame0(180, 400);
  await page.mouse.move(mid.x, mid.y);
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel({ deltaY: 400 });
    await new Promise((r) => setTimeout(r, 120));
  }
  await new Promise((r) => setTimeout(r, 600));
  const scrolls = await readAll('doc.scrollingElement.scrollTop');
  check('Scroll-Sync', scrolls.every((s) => s > 100), `scrollTop: ${scrolls.join(', ')}`);

  // Zurueckscrollen fuer stabile Klick-Koordinaten
  await page.evaluate(() => {
    const frames = [...document.getElementById('inkspect-root').shadowRoot.querySelectorAll('iframe')];
    for (const f of frames) f.contentDocument.scrollingElement.scrollTop = 0;
  });
  await new Promise((r) => setTimeout(r, 400));

  // --- 2. Klick-Sync: Menu-Button in Frame 1 ---
  const btn = inFrame0(150, 30);
  await page.mouse.click(btn.x, btn.y);
  await new Promise((r) => setTimeout(r, 400));
  const menus = await readAll('doc.body.classList.contains("menu-open")');
  check('Klick-Sync (Burger-Menu)', menus.every(Boolean), `menu-open: ${menus.join(', ')}`);

  // --- 3. Input-Sync: ins Feld tippen ---
  const input = inFrame0(150, 90);
  await page.mouse.click(input.x, input.y);
  await page.keyboard.type('Hallo Welt', { delay: 30 });
  await new Promise((r) => setTimeout(r, 400));
  const values = await readAll('doc.getElementById("name").value');
  check('Input-Sync', values.every((v) => v === 'Hallo Welt'), `values: ${values.join(' | ')}`);

  // --- 4. Hover-Sync: Maus ueber hoverBox ---
  const hover = inFrame0(150, 150);
  await page.mouse.move(hover.x, hover.y);
  await new Promise((r) => setTimeout(r, 400));
  const hovers = await readAll('doc.getElementById("hoverState").textContent');
  check('Hover-Sync (JS mouseover)', hovers.every((h) => h === 'hovered'), `states: ${hovers.join(', ')}`);

  // --- 5. CSS-:hover-Sync: computed background der hoverBox ---
  const bgs = await readAll(
    'doc.defaultView.getComputedStyle(doc.getElementById("hoverBox")).backgroundColor',
  );
  check('Hover-Sync (CSS :hover)', bgs.every((b) => b === 'rgb(255, 0, 0)'), `bg: ${bgs.join(' | ')}`);

  // --- 6. Klick-Sync in Shadow DOM ---
  const shadow = inFrame0(150, 250);
  await page.mouse.click(shadow.x, shadow.y);
  await new Promise((r) => setTimeout(r, 400));
  const shadowStates = await readAll('doc.getElementById("shadowState").textContent');
  check(
    'Klick-Sync (Shadow DOM)',
    shadowStates.every((s) => s === 'shadow-clicked'),
    `states: ${shadowStates.join(', ')}`,
  );

  // --- 7. Kommentar-Pin: Popup oeffnet, Notiz landet im Panel ---
  // Werkzeug ueber die immer sichtbare Palette waehlen — Tastatur-Shortcuts
  // kaemen beim fokussierten iframe an, nicht beim Top-Window.
  // Button-Reihenfolge: 0 Cursor (Interagieren), 1 Element, 2 Pin, 3 Stift, …
  const pickTool = (index) =>
    page.evaluate((i) => {
      const sr = document.getElementById('inkspect-root').shadowRoot;
      sr.querySelectorAll('.palette .icon-btn')[i].click();
    }, index);

  await pickTool(2); // Pin
  await new Promise((r) => setTimeout(r, 200));
  const pinSpot = inFrame0(180, 350);
  await page.mouse.click(pinSpot.x, pinSpot.y);
  await new Promise((r) => setTimeout(r, 300));

  const noteOpen = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const field = sr.querySelector('.anno__note-field');
    return { exists: !!field, focused: sr.activeElement === field };
  });
  check('Pin-Popup oeffnet', noteOpen.exists, `focused: ${noteOpen.focused}`);

  await page.keyboard.type('Logo zu klein', { delay: 20 });
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 300));

  const panel = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return {
      pins: sr.querySelectorAll('.anno__svg circle').length,
      labels: [...sr.querySelectorAll('.fb-item__label')].map((n) => n.textContent),
    };
  });
  check(
    'Pin + Notiz im Feedback-Panel',
    panel.pins === 1 && panel.labels.includes('Logo zu klein'),
    `pins: ${panel.pins}, labels: ${panel.labels.join(' | ')}`,
  );

  // --- 8. Element-Picker: Hover highlightet, Klick uebernimmt das Element ---
  await pickTool(1); // Element-Picker
  const elSpot = inFrame0(150, 90); // liegt auf <input id="name">
  await page.mouse.move(elSpot.x, elSpot.y);
  await new Promise((r) => setTimeout(r, 250));
  const hoverRects = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return sr.querySelectorAll('.anno__svg rect').length;
  });
  await page.mouse.click(elSpot.x, elSpot.y);
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.press('Escape'); // Notiz-Editor zu, Marker bleibt
  await new Promise((r) => setTimeout(r, 200));
  const elLabels = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return [...sr.querySelectorAll('.fb-item__label')].map((n) => n.textContent);
  });
  check(
    'Element-Picker (Hover + Klick)',
    hoverRects >= 1 && elLabels.includes('input#name'),
    `hoverRects: ${hoverRects}, labels: ${elLabels.join(' | ')}`,
  );

  // --- 8b. Freihand: kreuzende Striche verschmelzen, keine Notiz ---
  await pickTool(3); // Stift
  const drawStroke = async (x1, y1, x2, y2) => {
    const a = inFrame0(x1, y1);
    const b = inFrame0(x2, y2);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 150));
  };
  await drawStroke(60, 480, 170, 560); // Strich 1
  await drawStroke(60, 560, 170, 480); // Strich 2 — kreuzt Strich 1
  await drawStroke(60, 640, 170, 640); // separater Strich, weit genug weg
  const penInfo = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return {
      freihand: [...sr.querySelectorAll('.fb-item__label')].filter(
        (n) => n.textContent === 'Freihand',
      ).length,
      noteOpen: !!sr.querySelector('.anno__note'),
    };
  });
  check(
    'Freihand-Merge (kreuzende Striche, keine Notiz)',
    penInfo.freihand === 2 && !penInfo.noteOpen,
    `Freihand-Eintraege: ${penInfo.freihand}, Notiz offen: ${penInfo.noteOpen}`,
  );

  // --- 9. Scrollen im Korrekturmodus: Wheel ueber dem aktiven Overlay ---
  // Der Stift von Device 1 ist noch aktiv; das Overlay muss Wheel-Events
  // an den Frame weiterreichen statt sie zu schlucken.
  await page.mouse.move(mid.x, mid.y);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel({ deltaY: 400 });
    await new Promise((r) => setTimeout(r, 120));
  }
  await new Promise((r) => setTimeout(r, 600));
  const annoScroll = await readAll('doc.scrollingElement.scrollTop');
  check(
    'Scrollen im Korrekturmodus',
    annoScroll[0] > 100,
    `scrollTop: ${annoScroll.join(', ')}`,
  );

  // --- 10. Share-Link im Panel: URL erzeugen und Payload zurueckdecodieren ---
  const share = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.share-btn')?.click();
    await new Promise((res) => setTimeout(res, 400));
    const url = sr.querySelector('.share-box__url')?.value ?? '';
    const match = /#ink-feedback=([A-Za-z0-9_-]+)/.exec(url);
    if (!match) return { url, items: null };
    const b64 = match[1].replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const payload = JSON.parse(await new Response(stream).text());
    return { url, items: payload.items };
  });
  check(
    'Share-Link im Feedback-Panel',
    share.items?.length === 4 &&
      share.items.some((i) => i.shape.text === 'Logo zu klein') &&
      share.items.some((i) => i.shape.tool === 'element'),
    `items: ${share.items?.length ?? 'keine'}, url: ${share.url.slice(0, 60)}…`,
  );

  // --- 10b. Claude-Code-Prompt: Screenshots + Selektoren + Notizen ---
  const downloadDir = mkdtempSync(join(tmpdir(), 'inkspect-e2e-'));
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });

  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.share-btn--alt').click();
  });
  await page
    .waitForFunction(() => {
      const sr = document.getElementById('inkspect-root').shadowRoot;
      return !!sr.querySelector('.share-box__prompt');
    }, { timeout: 10000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 600)); // Download zu Ende schreiben lassen

  const promptText = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return sr.querySelector('.share-box__prompt')?.value ?? '';
  });
  const shotFiles = readdirSync(downloadDir).filter(
    (f) => f.startsWith('inkspect-feedback-') && f.endsWith('.png'),
  );
  check(
    'Claude-Code-Prompt (Screenshots + Selektoren)',
    promptText.includes('#name') &&
      promptText.includes('Logo zu klein') &&
      promptText.includes('iPhone SE (375×667)') &&
      promptText.includes('Hand-drawn markup') &&
      promptText.includes('inkspect-feedback-iphone-se.png') &&
      shotFiles.includes('inkspect-feedback-iphone-se.png'),
    `laenge: ${promptText.length}, dateien: ${shotFiles.join(', ') || 'keine'}`,
  );

  // --- 10c. Screenshot zeigt die Marker (rote Pixel von Pin/Strichen) ---
  let redPixels = 0;
  if (shotFiles.includes('inkspect-feedback-iphone-se.png')) {
    const b64 = readFileSync(join(downloadDir, 'inkspect-feedback-iphone-se.png')).toString(
      'base64',
    );
    redPixels = await page.evaluate(async (encoded) => {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = `data:image/png;base64,${encoded}`;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 190 && data[i + 1] < 130 && data[i + 2] < 130) count += 1;
      }
      return count;
    }, b64);
  }
  check('Screenshot zeigt Markierungen', redPixels > 50, `rote Pixel: ${redPixels}`);

  // --- 11. Link-Sync: Klick auf <a href> navigiert alle Frames ---
  await pickTool(0); // Interagieren — Overlays inaktiv, Klicks gehen zur Seite
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    for (const f of sr.querySelectorAll('iframe')) {
      f.contentDocument.scrollingElement.scrollTop = 0;
    }
  });
  await new Promise((r) => setTimeout(r, 400));

  const link = inFrame0(80, 395);
  await page.mouse.click(link.x, link.y);
  await new Promise((r) => setTimeout(r, 200));
  const loadbarDuring = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return !!sr.querySelector('.loadbar--active');
  });
  await page
    .waitForFunction(() => {
      const frames = [...document.getElementById('inkspect-root').shadowRoot.querySelectorAll('iframe')];
      return frames.every((f) => {
        try { return f.contentDocument.location.pathname === '/sub' && f.contentDocument.readyState === 'complete'; }
        catch { return false; }
      });
    }, { timeout: 8000 })
    .catch(() => {});
  const linkPaths = await readAll('doc.location.pathname');
  check('Link-Sync (a href)', linkPaths.every((p) => p === '/sub'), `paths: ${linkPaths.join(', ')}`);
  const loadbarAfter = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return !!sr.querySelector('.loadbar--active');
  });
  check(
    'Ladebalken bei Navigation',
    loadbarDuring && !loadbarAfter,
    `waehrend: ${loadbarDuring}, danach: ${loadbarAfter}`,
  );

  // --- 12. Navigations-Watchdog: Direkt-Navigation ohne Klick-Event ---
  // location.assign umgeht den Klick-Sync komplett — nur der Watchdog kann
  // die uebrigen Frames nachziehen.
  await new Promise((r) => setTimeout(r, 1200)); // Watchdog-Zustand nach /sub beruhigen lassen
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelectorAll('iframe')[0].contentWindow.location.assign('/watchdog');
  });
  await page
    .waitForFunction(() => {
      const frames = [...document.getElementById('inkspect-root').shadowRoot.querySelectorAll('iframe')];
      return frames.every((f) => {
        try { return f.contentDocument.location.pathname === '/watchdog'; }
        catch { return false; }
      });
    }, { timeout: 8000 })
    .catch(() => {});
  const wdPaths = await readAll('doc.location.pathname');
  check('Navigations-Watchdog', wdPaths.every((p) => p === '/watchdog'), `paths: ${wdPaths.join(', ')}`);

  // --- 13. Feedback ist seitengebunden; Panel-Klick wechselt zur Seite ---
  // Auf /watchdog duerfen die auf / gesetzten Marker nicht rendern; das
  // Panel listet sie unter ihrer Seite, ein Klick navigiert zurueck.
  await new Promise((r) => setTimeout(r, 800)); // activeUrl folgt via Watchdog-Tick
  const onOtherPage = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return {
      markers: sr.querySelectorAll('.anno__svg circle').length,
      pageHeads: [...sr.querySelectorAll('.fb-page__head')].map((n) => n.textContent),
      labels: [...sr.querySelectorAll('.fb-item__label')].map((n) => n.textContent),
    };
  });
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    [...sr.querySelectorAll('.fb-page__head')].find((b) => !b.disabled)?.click();
  });
  await page
    .waitForFunction(() => {
      const sr = document.getElementById('inkspect-root').shadowRoot;
      const frames = [...sr.querySelectorAll('iframe')];
      const home = frames.every((f) => {
        try { return f.contentDocument.location.pathname === '/' && f.contentDocument.readyState === 'complete'; }
        catch { return false; }
      });
      return home && sr.querySelectorAll('.anno__svg circle').length === 1;
    }, { timeout: 8000 })
    .catch(() => {});
  const backHome = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return {
      path: sr.querySelector('iframe').contentDocument.location.pathname,
      markers: sr.querySelectorAll('.anno__svg circle').length,
    };
  });
  check(
    'Feedback seitengebunden + Panel-Navigation',
    onOtherPage.markers === 0 &&
      onOtherPage.labels.includes('Logo zu klein') &&
      backHome.path === '/' &&
      backHome.markers === 1,
    `fremde Seite: markers ${onOtherPage.markers}, labels ${onOtherPage.labels.length}; zurueck: ${backHome.path}, markers ${backHome.markers}`,
  );

  // --- 14. Legacy-Import: alte Pen-Shapes (points statt strokes) crashen nicht ---
  const legacyUrl = await page.evaluate(async () => {
    const payload = {
      v: 1,
      items: [
        {
          id: 'legacy-1',
          url: 'http://localhost:8973/legacy',
          deviceId: 'iphone-se',
          createdAt: 1,
          shape: {
            id: 'legacy-1',
            tool: 'pen',
            color: '#ff5d5d',
            points: [{ x: 10, y: 10 }, { x: 60, y: 60 }, { x: 110, y: 20 }],
          },
        },
      ],
    };
    const raw = new TextEncoder().encode(JSON.stringify(payload));
    const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    const b64 = btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    return `http://localhost:8973/legacy#ink-feedback=${b64}`;
  });
  await page.goto(legacyUrl, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1500)); // document_idle + Import + Auto-Open
  const legacy = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root')?.shadowRoot;
    return {
      open: !!sr,
      crashed: sr ? sr.textContent.includes('abgestuerzt') : false,
      polylines: sr ? sr.querySelectorAll('.anno__svg polyline').length : 0,
    };
  });
  check(
    'Legacy-Pen-Import ohne Crash',
    legacy.open && !legacy.crashed && legacy.polylines >= 1,
    `open: ${legacy.open}, crashed: ${legacy.crashed}, polylines: ${legacy.polylines}`,
  );
} catch (e) {
  results.push(`ERROR ${e.message}`);
} finally {
  await browser.close();
  server.close();
}

console.log(results.join('\n'));
process.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0);
