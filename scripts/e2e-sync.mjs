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
  <!-- Sticky-Header (violett): darf im Full-Page-Screenshot nur EINMAL erscheinen -->
  <div id="sticky" style="position:sticky;top:0;margin-left:320px;width:40px;height:50px;background:rgb(140,40,220)"></div>
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
  // Fuer den Copy-to-Clipboard-Test des Share-Links.
  await browser
    .defaultBrowserContext()
    .overridePermissions('http://localhost:8973', ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'])
    .catch(() => {});
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

  // --- 0b. Omnibox: Domain fix, nur der Pfad ist editierbar ---
  const omni = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return {
      origin: sr.querySelector('.omnibox__origin')?.textContent,
      path: sr.querySelector('.omnibox__input')?.value,
    };
  });
  check(
    'Omnibox: Domain fix, Pfad editierbar',
    omni.origin === 'localhost:8973' && omni.path === '/',
    `origin: ${omni.origin}, path: ${omni.path}`,
  );

  // --- 0c. Sync-Submenue: oeffnet AM Button (im Viewport), Rows schalten ---
  // Regression: ohne position:relative am Menue-Anker landete das Dropdown
  // unterhalb des Viewports und war unsichtbar.
  const syncMenu = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const btn = [...sr.querySelectorAll('.toolbar .icon-btn')].find((b) =>
      b.title.includes('mirrored'),
    );
    btn.click();
    await new Promise((r) => setTimeout(r, 100));
    const menu = sr.querySelector('.menu');
    if (!menu) return null;
    const rect = menu.getBoundingClientRect();
    const inView =
      rect.top > 40 && rect.bottom < window.innerHeight && rect.left >= 0 && rect.height > 0;
    const rowFor = (label) =>
      [...sr.querySelectorAll('[role="menuitemcheckbox"]')].find((n) =>
        n.textContent.includes(label),
      );
    const labels = [...sr.querySelectorAll('[role="menuitemcheckbox"]')].map(
      (n) => n.textContent,
    );
    rowFor('Hover').click();
    await new Promise((r) => setTimeout(r, 100));
    const toggledOff = rowFor('Hover').getAttribute('aria-checked') === 'false';
    rowFor('Hover').click();
    await new Promise((r) => setTimeout(r, 100));
    const restored = rowFor('Hover').getAttribute('aria-checked') === 'true';
    sr.querySelector('.menu-backdrop')?.click();
    await new Promise((r) => setTimeout(r, 60));
    return { inView, labels, toggledOff, restored, closed: !sr.querySelector('.menu') };
  });
  check(
    'Sync-Submenue oeffnet am Button und schaltet einzeln',
    syncMenu != null &&
      syncMenu.inView &&
      syncMenu.labels.length === 3 &&
      syncMenu.toggledOff &&
      syncMenu.restored &&
      syncMenu.closed,
    syncMenu
      ? `imViewport: ${syncMenu.inView}, rows: ${syncMenu.labels.join('/')}, toggle: ${syncMenu.toggledOff}/${syncMenu.restored}`
      : 'Menue fehlt',
  );

  // Frame-Geometrie dynamisch messen: das zeilenfuellende Grid skaliert die
  // Frames neu, sobald sich die verfuegbare Breite aendert (z.B. wenn das
  // Feedback-Panel auf- oder zugeht) — statische Koordinaten veralten dann.
  const frameRect = (index = 0) =>
    page.evaluate((i) => {
      const f = [
        ...document.getElementById('inkspect-root').shadowRoot.querySelectorAll('iframe'),
      ][i];
      const r = f.getBoundingClientRect();
      return { left: r.left, top: r.top, scale: r.width / f.width };
    }, index);
  const inFrame0 = async (x, y) => {
    const f = await frameRect(0);
    return { x: f.left + x * f.scale, y: f.top + y * f.scale };
  };

  const readAll = (expr) =>
    page.evaluate((e) => {
      const frames = [...document.getElementById('inkspect-root').shadowRoot.querySelectorAll('iframe')];
      return frames.map((f) => {
        try { return new Function('doc', `return ${e}`)(f.contentDocument); }
        catch { return null; }
      });
    }, expr);

  // --- 1. Scroll-Sync: Wheel ueber Frame 1 ---
  const mid = await inFrame0(180, 400);
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

  // --- 1b. Touch-Modus: Mobile-Devices starten mit Touch, Desktop ohne ---
  const touchDefaults = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return [...sr.querySelectorAll('.device__touch')].map(
      (b) => b.getAttribute('aria-pressed') === 'true',
    );
  });
  check(
    'Touch-Modus: Default nur auf Mobile-Viewports',
    touchDefaults.length === 2 && touchDefaults[0] === true && touchDefaults[1] === false,
    `touch: ${touchDefaults.join(', ')}`,
  );

  // --- 1c. Touch-Pan: Ziehen im Touch-Frame scrollt die Seite ---
  const panStart = await inFrame0(150, 340);
  const panEnd = await inFrame0(150, 120);
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  await page.mouse.move(panEnd.x, panEnd.y, { steps: 12 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 400));
  const panScrolls = await readAll('doc.scrollingElement.scrollTop');
  check('Touch-Pan scrollt die Seite', panScrolls[0] > 50, `scrollTop: ${panScrolls.join(', ')}`);
  await page.evaluate(() => {
    const frames = [...document.getElementById('inkspect-root').shadowRoot.querySelectorAll('iframe')];
    for (const f of frames) f.contentDocument.scrollingElement.scrollTop = 0;
  });
  await new Promise((r) => setTimeout(r, 400));

  // --- 1d. Touch-Frames senden keinen Hover an die anderen Frames ---
  const touchHoverSpot = await inFrame0(150, 150);
  await page.mouse.move(touchHoverSpot.x, touchHoverSpot.y);
  await new Promise((r) => setTimeout(r, 400));
  const touchHovers = await readAll('doc.getElementById("hoverState").textContent');
  check(
    'Touch-Modus blockiert Hover-Sync',
    touchHovers[1] === 'no-hover',
    `states: ${touchHovers.join(', ')}`,
  );
  await page.mouse.move(4, 500); // Frame verlassen
  await new Promise((r) => setTimeout(r, 300));

  // Touch am iPhone abschalten — die folgenden Tests erwarten Maus-Verhalten.
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelectorAll('.device__touch')[0].click();
  });
  await new Promise((r) => setTimeout(r, 200));

  // --- 2. Klick-Sync: Menu-Button in Frame 1 ---
  const btn = await inFrame0(150, 30);
  await page.mouse.click(btn.x, btn.y);
  await new Promise((r) => setTimeout(r, 400));
  const menus = await readAll('doc.body.classList.contains("menu-open")');
  check('Klick-Sync (Burger-Menu)', menus.every(Boolean), `menu-open: ${menus.join(', ')}`);

  // --- 3. Input-Sync: ins Feld tippen ---
  const input = await inFrame0(150, 90);
  await page.mouse.click(input.x, input.y);
  await page.keyboard.type('Hallo Welt', { delay: 30 });
  await new Promise((r) => setTimeout(r, 400));
  const values = await readAll('doc.getElementById("name").value');
  check('Input-Sync', values.every((v) => v === 'Hallo Welt'), `values: ${values.join(' | ')}`);

  // --- 4. Hover-Sync: Maus ueber hoverBox ---
  const hover = await inFrame0(150, 150);
  await page.mouse.move(hover.x, hover.y);
  await new Promise((r) => setTimeout(r, 400));
  const hovers = await readAll('doc.getElementById("hoverState").textContent');
  check('Hover-Sync (JS mouseover)', hovers.every((h) => h === 'hovered'), `states: ${hovers.join(', ')}`);

  // --- 5. CSS-:hover-Sync: computed background der hoverBox ---
  const bgs = await readAll(
    'doc.defaultView.getComputedStyle(doc.getElementById("hoverBox")).backgroundColor',
  );
  check('Hover-Sync (CSS :hover)', bgs.every((b) => b === 'rgb(255, 0, 0)'), `bg: ${bgs.join(' | ')}`);

  // --- 5b. Hover loest sich, wenn der Zeiger den Frame verlaesst ---
  // Ohne den mouseout-Reset bliebe der simulierte :hover in den Ziel-Frames
  // haengen (es kommt kein weiteres mouseover mehr).
  const f0edge = await frameRect(0);
  await page.mouse.move(Math.max(4, f0edge.left - 12), 500);
  await new Promise((r) => setTimeout(r, 500));
  const bgsAfter = await readAll(
    'doc.defaultView.getComputedStyle(doc.getElementById("hoverBox")).backgroundColor',
  );
  check(
    'Hover-Sync loest beim Verlassen des Frames',
    bgsAfter.every((b) => b !== 'rgb(255, 0, 0)'),
    `bg: ${bgsAfter.join(' | ')}`,
  );

  // --- 6. Klick-Sync in Shadow DOM ---
  const shadow = await inFrame0(150, 250);
  await page.mouse.click(shadow.x, shadow.y);
  await new Promise((r) => setTimeout(r, 400));
  const shadowStates = await readAll('doc.getElementById("shadowState").textContent');
  check(
    'Klick-Sync (Shadow DOM)',
    shadowStates.every((s) => s === 'shadow-clicked'),
    `states: ${shadowStates.join(', ')}`,
  );

  // --- 7. Kommentar-Pin: Popup oeffnet, Notiz landet im Panel ---
  // Die Palette ist ein Kontextmenue: Rechtsklick auf das Grid oeffnet sie
  // neben der Maus, Werkzeugwahl schliesst sie wieder. Tastatur-Shortcuts
  // kaemen beim fokussierten iframe an, nicht beim Top-Window.
  // Button-Reihenfolge: 0 Cursor (Interagieren), 1 Element, 2 Pin, 3 Stift, …
  const openPalette = (x = 40, y = 90) =>
    page.evaluate(
      (cx, cy) => {
        const sr = document.getElementById('inkspect-root').shadowRoot;
        sr.querySelector('.grid').dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: cx,
            clientY: cy,
          }),
        );
      },
      x,
      y,
    );
  const pickTool = async (index) => {
    await openPalette();
    await new Promise((r) => setTimeout(r, 60));
    await page.evaluate((i) => {
      const sr = document.getElementById('inkspect-root').shadowRoot;
      sr.querySelectorAll('.palette .icon-btn')[i].click();
    }, index);
  };

  // --- 6b. Palette erscheint per Rechtsklick neben der Maus ---
  await openPalette(320, 260);
  await new Promise((r) => setTimeout(r, 80));
  const paletteInfo = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const el = sr.querySelector('.palette');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  });
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.palette-backdrop')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
  });
  await new Promise((r) => setTimeout(r, 60));
  const paletteClosed = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return sr.querySelector('.palette') == null;
  });
  check(
    'Palette oeffnet per Rechtsklick neben der Maus',
    paletteInfo != null &&
      Math.abs(paletteInfo.left - 326) < 30 &&
      Math.abs(paletteInfo.top - 270) < 30 &&
      paletteClosed,
    `pos: ${paletteInfo ? `${Math.round(paletteInfo.left)},${Math.round(paletteInfo.top)}` : 'fehlt'}, geschlossen: ${paletteClosed}`,
  );

  // Rechtsklick *innerhalb* einer Vorschau (Frame-Dokument) oeffnet sie auch —
  // die Frame-Koordinaten muessen ueber den Zoom in Shell-Koordinaten landen.
  const framePalette = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const iframe = sr.querySelector('iframe');
    const rect = iframe.getBoundingClientRect();
    iframe.contentDocument.body.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 150 }),
    );
    await new Promise((r) => setTimeout(r, 80));
    const el = sr.querySelector('.palette');
    if (!el) return null;
    const p = el.getBoundingClientRect();
    const scale = rect.width / Number(iframe.width);
    const dx = Math.abs(p.left - (rect.left + 100 * scale + 6));
    const dy = Math.abs(p.top - (rect.top + 150 * scale + 10));
    sr.querySelector('.palette-backdrop')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { dx, dy };
  });
  await new Promise((r) => setTimeout(r, 60));
  check(
    'Rechtsklick in der Vorschau oeffnet Palette',
    framePalette != null && framePalette.dx < 30 && framePalette.dy < 30,
    framePalette ? `abweichung: ${Math.round(framePalette.dx)},${Math.round(framePalette.dy)}` : 'fehlt',
  );

  await pickTool(2); // Pin
  // Werkzeugwahl oeffnet das Panel — das Grid skaliert neu, erst dann messen.
  await new Promise((r) => setTimeout(r, 400));
  const pinSpot = await inFrame0(180, 350);
  await page.mouse.click(pinSpot.x, pinSpot.y);
  await new Promise((r) => setTimeout(r, 300));

  // --- 7-0. Nach dem Absetzen springt das Werkzeug auf Interagieren zurueck ---
  const toolReset = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return sr.querySelectorAll('.device--annotating').length === 0;
  });
  check('Werkzeug springt nach Feedback auf Interagieren zurueck', toolReset);

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

  // --- 7b. Notiz erscheint beim Hover ueber dem Marker ---
  await page.mouse.move(pinSpot.x + 120, pinSpot.y + 60);
  await new Promise((r) => setTimeout(r, 200));
  const bubbleAway = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return [...sr.querySelectorAll('.anno__svg text')].some(
      (t) => t.textContent === 'Logo zu klein',
    );
  });
  await page.mouse.move(pinSpot.x, pinSpot.y);
  await new Promise((r) => setTimeout(r, 300));
  const bubbleOn = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return [...sr.querySelectorAll('.anno__svg text')].some(
      (t) => t.textContent === 'Logo zu klein',
    );
  });
  check(
    'Notiz erscheint beim Hover ueber dem Marker',
    !bubbleAway && bubbleOn,
    `abseits: ${bubbleAway}, auf Marker: ${bubbleOn}`,
  );

  // --- 7c. Marker-Toggle im Panel-Kopf blendet alle Markierungen aus ---
  const eyeToggle = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const btn = sr.querySelector('.panel__head .icon-btn');
    btn.click();
    await new Promise((r) => setTimeout(r, 250));
    const hidden = sr.querySelectorAll('.anno__svg circle').length;
    btn.click();
    await new Promise((r) => setTimeout(r, 250));
    const shown = sr.querySelectorAll('.anno__svg circle').length;
    return { hidden, shown };
  });
  check(
    'Marker-Toggle im Panel-Kopf',
    eyeToggle.hidden === 0 && eyeToggle.shown === 1,
    `ausgeblendet: ${eyeToggle.hidden}, wieder an: ${eyeToggle.shown}`,
  );

  // --- 7d. Panel-Klick springt zum Marker: Flash auf Marker + Device ---
  const jump = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.fb-item')?.click();
    await new Promise((r) => setTimeout(r, 350));
    return {
      markerFlash: !!sr.querySelector('.anno__flash'),
      deviceFlash: !!sr.querySelector('.device--flash'),
    };
  });
  check(
    'Panel-Klick springt zum Marker (Flash)',
    jump.markerFlash && jump.deviceFlash,
    `marker: ${jump.markerFlash}, device: ${jump.deviceFlash}`,
  );

  // --- 7e. Device-Badge hebt die Panel-Gruppe hervor ---
  const badgeFlash = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.device__anno-count')?.click();
    await new Promise((r) => setTimeout(r, 250));
    return !!sr.querySelector('.fb-group--flash');
  });
  check('Device-Badge flasht die Panel-Gruppe', badgeFlash);

  // --- 7f. Notiz im Panel editierbar (aendern und wieder zuruecksetzen) ---
  const editNote = async (from, to) => {
    await page.evaluate((label) => {
      const sr = document.getElementById('inkspect-root').shadowRoot;
      const item = [...sr.querySelectorAll('.fb-item')].find(
        (li) => li.querySelector('.fb-item__label')?.textContent === label,
      );
      item?.querySelector('.fb-item__actions button')?.click(); // Edit-Stift
    }, from);
    await new Promise((r) => setTimeout(r, 120));
    await page.evaluate((value) => {
      const sr = document.getElementById('inkspect-root').shadowRoot;
      const field = sr.querySelector('.fb-item__edit');
      if (!field) return;
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(field),
        'value',
      ).set;
      setter.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.blur(); // blur speichert
    }, to);
    await new Promise((r) => setTimeout(r, 200));
    return page.evaluate(
      (label) =>
        [
          ...document
            .getElementById('inkspect-root')
            .shadowRoot.querySelectorAll('.fb-item__label'),
        ].some((n) => n.textContent === label),
      to,
    );
  };
  const edited = await editNote('Logo zu klein', 'Logo viel zu klein');
  const reverted = await editNote('Logo viel zu klein', 'Logo zu klein');
  check('Notiz im Panel editierbar', edited && reverted, `geaendert: ${edited}, zurueck: ${reverted}`);

  // --- 7g. Doppelklick auf einen Marker oeffnet den Notiz-Editor im Viewport ---
  // Im Interaktionsmodus landen die Klicks im Frame; die App hit-testet die
  // Marker-Bounds und oeffnet den Editor mit dem vorhandenen Text.
  const readNoteField = () =>
    page.evaluate(() => {
      const sr = document.getElementById('inkspect-root').shadowRoot;
      return sr.querySelector('.anno__note-field')?.value ?? null;
    });
  const writeNoteField = (value) =>
    page.evaluate((v) => {
      const sr = document.getElementById('inkspect-root').shadowRoot;
      const field = sr.querySelector('.anno__note-field');
      if (!field) return;
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(field),
        'value',
      ).set;
      setter.call(field, v);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.blur(); // blur speichert
    }, value);
  // Frames auf 0 zurueckscrollen — der Hit-Test rechnet in Dokument-
  // Koordinaten, ein Rest-Scroll wuerde den Klickpunkt verschieben.
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    for (const f of sr.querySelectorAll('iframe')) f.contentWindow.scrollTo(0, 0);
  });
  await new Promise((r) => setTimeout(r, 200));
  const dblSpot = await inFrame0(180, 350); // Pin "Logo zu klein"
  await page.mouse.click(dblSpot.x, dblSpot.y, { count: 2 });
  await new Promise((r) => setTimeout(r, 350));
  const dblPrefill = await readNoteField();
  await writeNoteField('Logo winzig');
  await new Promise((r) => setTimeout(r, 250));
  const dblSaved = await page.evaluate(() =>
    [
      ...document
        .getElementById('inkspect-root')
        .shadowRoot.querySelectorAll('.fb-item__label'),
    ].some((n) => n.textContent === 'Logo winzig'),
  );
  // Zweiter Doppelklick: Editor zeigt den neuen Text — dann zuruecksetzen,
  // damit die Folge-Tests ihren bekannten Zustand vorfinden.
  await page.mouse.click(dblSpot.x, dblSpot.y, { count: 2 });
  await new Promise((r) => setTimeout(r, 350));
  const dblPrefill2 = await readNoteField();
  await writeNoteField('Logo zu klein');
  await new Promise((r) => setTimeout(r, 250));
  check(
    'Doppelklick auf Marker oeffnet Notiz-Editor',
    dblPrefill === 'Logo zu klein' && dblSaved && dblPrefill2 === 'Logo winzig',
    `prefill: ${dblPrefill}, gespeichert: ${dblSaved}, prefill2: ${dblPrefill2}`,
  );

  // --- 7g. Hover ueber Panel-Eintrag hebt den Marker im Viewport hervor ---
  const hoverMark = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const item = [...sr.querySelectorAll('.fb-item')].find(
      (li) => li.querySelector('.fb-item__label')?.textContent === 'Logo zu klein',
    );
    item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    const marked = !!sr.querySelector('.anno__mark-hover');
    item.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    return { marked, cleared: !sr.querySelector('.anno__mark-hover') };
  });
  check(
    'Panel-Hover hebt Marker hervor',
    hoverMark.marked && hoverMark.cleared,
    `hervorgehoben: ${hoverMark.marked}, wieder weg: ${hoverMark.cleared}`,
  );

  // Ausgangszustand: Scroll zuruecksetzen (der Marker-Sprung hat gescrollt)
  // und Flash-Animationen auslaufen lassen.
  await new Promise((r) => setTimeout(r, 1600));
  await page.evaluate(() => {
    const frames = [...document.getElementById('inkspect-root').shadowRoot.querySelectorAll('iframe')];
    for (const f of frames) f.contentDocument.scrollingElement.scrollTop = 0;
  });
  await new Promise((r) => setTimeout(r, 400));

  // --- 8. Element-Picker: Hover highlightet, Klick uebernimmt das Element ---
  await pickTool(1); // Element-Picker
  const elSpot = await inFrame0(150, 90); // liegt auf <input id="name">
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

  // --- 8a. Element-Marker wird auf alle Viewports repliziert ---
  // Derselbe Selektor wird im Laptop-Frame aufgeloest und dort als eigener
  // Eintrag (eigene Bounding-Box) gespeichert — je Device eine Gruppe.
  const elSync = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return {
      items: [...sr.querySelectorAll('.fb-item__label')].filter(
        (n) => n.textContent === 'input#name',
      ).length,
      groups: [...sr.querySelectorAll('.fb-group__name')].map((n) => n.textContent),
    };
  });
  check(
    'Element-Marker auf alle Viewports gesynct',
    elSync.items === 2 && elSync.groups.includes('Laptop'),
    `Eintraege: ${elSync.items}, Gruppen: ${elSync.groups.join(' | ')}`,
  );

  // --- 8b. Freihand: kreuzende Striche verschmelzen, keine Notiz ---
  // Das Werkzeug springt nach jedem Strich auf Interagieren zurueck —
  // vor jedem Strich neu waehlen.
  const drawStroke = async (x1, y1, x2, y2) => {
    await pickTool(3); // Stift
    await new Promise((r) => setTimeout(r, 120));
    const a = await inFrame0(x1, y1);
    const b = await inFrame0(x2, y2);
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
      // Freihand ohne Notiz zeigt "Add note…" als Hauptzeile — gezaehlt
      // wird ueber die Werkzeug-Kontextzeile.
      freihand: [...sr.querySelectorAll('.fb-item__meta')].filter(
        (n) => n.textContent === 'Freehand',
      ).length,
      noteOpen: !!sr.querySelector('.anno__note'),
    };
  });
  check(
    'Freihand-Merge (kreuzende Striche, keine Notiz)',
    penInfo.freihand === 2 && !penInfo.noteOpen,
    `Freihand-Eintraege: ${penInfo.freihand}, Notiz offen: ${penInfo.noteOpen}`,
  );

  // --- 8c. Freihand bekommt im Panel einen Kommentar ---
  const penNote = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const item = [...sr.querySelectorAll('.fb-item')].find(
      (li) => li.querySelector('.fb-item__meta')?.textContent === 'Freehand',
    );
    item?.querySelector('.fb-item__label')?.click(); // leere Notiz startet den Editor
    await new Promise((r) => setTimeout(r, 150));
    const field = sr.querySelector('.fb-item__edit');
    if (!field) return { edited: false };
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set;
    setter.call(field, 'Linie krumm');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.blur();
    await new Promise((r) => setTimeout(r, 250));
    return {
      edited: [...sr.querySelectorAll('.fb-item__label')].some(
        (n) => n.textContent === 'Linie krumm',
      ),
    };
  });
  check('Freihand-Kommentar im Panel', penNote.edited === true);

  // --- 9. Scrollen im Korrekturmodus: Wheel ueber dem aktiven Overlay ---
  // Stift wieder aktivieren; das Overlay muss Wheel-Events an den Frame
  // weiterreichen statt sie zu schlucken.
  await pickTool(3);
  await new Promise((r) => setTimeout(r, 150));
  const mid2 = await inFrame0(180, 400);
  await page.mouse.move(mid2.x, mid2.y);
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
    // 5 Eintraege: Pin, Element (iPhone + Laptop-Replikat), 2× Freihand.
    share.items?.length === 5 &&
      share.items.some((i) => i.shape.text === 'Logo zu klein') &&
      share.items.some((i) => i.shape.tool === 'element') &&
      share.items.some((i) => i.shape.note === 'Linie krumm'),
    `items: ${share.items?.length ?? 'keine'}, url: ${share.url.slice(0, 60)}…`,
  );

  // --- 10a. Share-Link landet direkt in der Zwischenablage ---
  const shareCopied = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const hintOk = [...sr.querySelectorAll('.share-hint')].some((n) =>
      n.textContent.includes('copied'),
    );
    let clipboard = '';
    try {
      clipboard = await navigator.clipboard.readText();
    } catch {
      /* Headless verweigert evtl. den Lese-Zugriff */
    }
    return { hintOk, clipboardMatches: clipboard.includes('#ink-feedback=') };
  });
  check(
    'Share-Link in Zwischenablage kopiert',
    shareCopied.hintOk,
    `hint: ${shareCopied.hintOk}, clipboard: ${shareCopied.clipboardMatches}`,
  );

  // --- 10b. Screenshots-Export: annotierte Full-Page-PNGs im Download-Ordner ---
  // Frame-Skalierung vor dem Export merken — die erwartete Bildhoehe haengt
  // am zeilenfuellenden Zoom, nicht mehr am festen Stepper-Wert.
  const exportScale = (await frameRect(0)).scale;
  const downloadDir = mkdtempSync(join(tmpdir(), 'inkspect-e2e-'));
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });

  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.share-btn--alt').click();
  });
  // Export ist fertig, sobald das Panel die Erfolgsmeldung zeigt.
  await page
    .waitForFunction(() => {
      const sr = document.getElementById('inkspect-root').shadowRoot;
      return [...sr.querySelectorAll('.share-hint')].some((n) =>
        n.textContent.includes('Downloads'),
      );
      // Full-Page: ~6 Slices × 600 ms plus Capture-Zeit
    }, { timeout: 30000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 600)); // Download zu Ende schreiben lassen

  const shotFiles = readdirSync(downloadDir).filter(
    (f) => f.startsWith('inkspect-feedback-') && f.endsWith('.png'),
  );
  const shotFile = 'inkspect-feedback-home-iphone-se.png';
  check(
    'Screenshots-Export (Datei pro Device mit Feedback)',
    shotFiles.includes(shotFile),
    `dateien: ${shotFiles.join(', ') || 'keine'}`,
  );

  // --- 10c. Screenshot zeigt die Marker (rote Pixel von Pin/Strichen) ---
  let redPixels = 0;
  let darkPixels = 0;
  let purplePixels = 0;
  let shotSize = { w: 0, h: 0 };
  if (shotFiles.includes(shotFile)) {
    const b64 = readFileSync(join(downloadDir, shotFile)).toString('base64');
    ({ redPixels, darkPixels, purplePixels, shotSize } = await page.evaluate(async (encoded) => {
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
      let red = 0;
      let dark = 0;
      let purple = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (r > 190 && g < 130 && b < 130) red += 1;
        // Notiz-Sprechblase: rgba(14,16,20,.92) ueber weisser Seite blendet zu
        // ca. rgb(33,35,39) — leicht blaustichig, anders als neutralgrauer
        // Text-Antialias (r==g==b).
        if (Math.abs(r - 33) <= 6 && Math.abs(g - 35) <= 6 && Math.abs(b - 39) <= 7 && b > r) {
          dark += 1;
        }
        // Sticky-Header der Testseite: rgb(140,40,220).
        if (r > 110 && r < 170 && g < 80 && b > 190) purple += 1;
      }
      return {
        redPixels: red,
        darkPixels: dark,
        purplePixels: purple,
        shotSize: { w: img.naturalWidth, h: img.naturalHeight },
      };
    }, b64));
  }
  check('Screenshot zeigt Markierungen', redPixels > 50, `rote Pixel: ${redPixels}`);
  check(
    'Screenshot zeigt Notiz-Sprechblase am Marker',
    darkPixels > 100,
    `Sprechblasen-Pixel: ${darkPixels}`,
  );
  // Full-Page: Testseite ist 4000 px hoch → Dokumenthoehe × Frame-Skalierung.
  const expectedH = 4000 * exportScale;
  check(
    'Screenshot ist Full-Page (ganze Dokumenthoehe)',
    Math.abs(shotSize.h - expectedH) < expectedH * 0.08 && shotSize.w > 200,
    `${shotSize.w}×${shotSize.h}, erwartet ~${Math.round(expectedH)}`,
  );
  // Sticky-Header (40×50 px logisch) darf nur EINMAL im Bild stehen — ohne
  // Unterdrueckung staende er auf jedem der ~6 Slices.
  const headerPx = 40 * 50 * exportScale * exportScale;
  check(
    'Sticky-Header nur einmal im Full-Page-Screenshot',
    purplePixels > headerPx * 0.3 && purplePixels < headerPx * 2.5,
    `violette Pixel: ${purplePixels}, ein Header ~${Math.round(headerPx)}`,
  );

  // --- 10d. Erledigt-Status: abhaken dimmt Marker und zaehlt Badge runter ---
  const doneState = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const countBefore = sr.querySelector('.panel__count')?.textContent;
    sr.querySelectorAll('.fb-check')[1]?.click(); // Element-Eintrag (input#name)
    await new Promise((r) => setTimeout(r, 300));
    const dimmed = [...sr.querySelectorAll('.anno__svg g')].filter(
      (g) => g.getAttribute('opacity') === '0.35',
    ).length;
    return {
      countBefore,
      countAfter: sr.querySelector('.panel__count')?.textContent,
      dimmed,
      struck: sr.querySelectorAll('.fb-item--done').length,
    };
  });
  check(
    'Erledigt-Status (Badge + gedimmter Marker)',
    doneState.countBefore === '5' &&
      doneState.countAfter === '4' &&
      doneState.dimmed === 1 &&
      doneState.struck === 1,
    `badge ${doneState.countBefore}→${doneState.countAfter}, dimmed: ${doneState.dimmed}`,
  );

  const hiddenCount = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.panel__menu > button')?.click();
    await new Promise((r) => setTimeout(r, 150));
    [...sr.querySelectorAll('.menu__item')]
      .find((b) => b.textContent.includes('Hide completed'))
      ?.click();
    await new Promise((r) => setTimeout(r, 200));
    return sr.querySelectorAll('.fb-item').length;
  });
  check('Hide completed blendet Erledigtes aus', hiddenCount === 4, `sichtbar: ${hiddenCount}`);

  // Ausgangszustand fuer Folge-Tests wiederherstellen
  await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.panel__menu > button')?.click();
    await new Promise((r) => setTimeout(r, 150));
    [...sr.querySelectorAll('.menu__item')]
      .find((b) => b.textContent.includes('Show completed'))
      ?.click();
    await new Promise((r) => setTimeout(r, 200));
    sr.querySelectorAll('.fb-check')[1]?.click();
  });
  await new Promise((r) => setTimeout(r, 300));

  // --- 11. Link-Sync: Klick auf <a href> navigiert alle Frames ---
  await pickTool(0); // Interagieren — Overlays inaktiv, Klicks gehen zur Seite
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    for (const f of sr.querySelectorAll('iframe')) {
      f.contentDocument.scrollingElement.scrollTop = 0;
    }
  });
  await new Promise((r) => setTimeout(r, 400));

  const link = await inFrame0(80, 395);
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

  // --- 13. Feedback ist seitengebunden; Item-Klick springt seitenuebergreifend ---
  // Auf /watchdog duerfen die auf / gesetzten Marker nicht rendern; das
  // Panel listet sie unter ihrer Seite. Ein Klick auf den Eintrag navigiert
  // zurueck und fliegt danach den Marker an (Flash).
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
    window.__inkFlashSeen = false;
    [...sr.querySelectorAll('.fb-item')]
      .find((li) => li.querySelector('.fb-item__label')?.textContent === 'Logo zu klein')
      ?.click();
  });
  await page
    .waitForFunction(() => {
      const sr = document.getElementById('inkspect-root').shadowRoot;
      if (sr.querySelector('.anno__flash')) window.__inkFlashSeen = true;
      const frames = [...sr.querySelectorAll('iframe')];
      const home = frames.every((f) => {
        try { return f.contentDocument.location.pathname === '/' && f.contentDocument.readyState === 'complete'; }
        catch { return false; }
      });
      return home && sr.querySelectorAll('.anno__svg circle').length === 1 && window.__inkFlashSeen;
    }, { timeout: 10_000 })
    .catch(() => {});
  const backHome = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return {
      path: sr.querySelector('iframe').contentDocument.location.pathname,
      markers: sr.querySelectorAll('.anno__svg circle').length,
      flashSeen: window.__inkFlashSeen === true,
    };
  });
  check(
    'Feedback seitengebunden + Item-Sprung ueber Seiten',
    onOtherPage.markers === 0 &&
      onOtherPage.labels.includes('Logo zu klein') &&
      backHome.path === '/' &&
      backHome.markers === 1 &&
      backHome.flashSeen,
    `fremde Seite: markers ${onOtherPage.markers}, labels ${onOtherPage.labels.length}; zurueck: ${backHome.path}, markers ${backHome.markers}, flash: ${backHome.flashSeen}`,
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
      crashed: sr ? sr.textContent.includes('Inkspect crashed') : false,
      polylines: sr ? sr.querySelectorAll('.anno__svg polyline').length : 0,
    };
  });
  check(
    'Legacy-Pen-Import ohne Crash',
    legacy.open && !legacy.crashed && legacy.polylines >= 1,
    `open: ${legacy.open}, crashed: ${legacy.crashed}, polylines: ${legacy.polylines}`,
  );

  // --- 15. Custom Device anlegen; Grid + Preset ueberleben einen Reload ---
  await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.add-device > button').click();
    await new Promise((r) => setTimeout(r, 150));
    // React liest Werte ueber onChange — native Setter + input-Event noetig.
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setValue(sr.querySelector('.menu__custom-name'), 'Kiosk');
    const sizes = sr.querySelectorAll('.menu__custom-size input');
    setValue(sizes[0], '500');
    setValue(sizes[1], '700');
    await new Promise((r) => setTimeout(r, 100));
    sr.querySelector('.menu__custom-add').click();
  });
  await new Promise((r) => setTimeout(r, 800)); // Grid-Save ist 300 ms debounced
  const custom = await page.evaluate(() => {
    const frames = [...document.getElementById('inkspect-root').shadowRoot.querySelectorAll('iframe')];
    return { frames: frames.length, widths: frames.map((f) => Number(f.width)) };
  });
  check(
    'Custom Device im Grid',
    custom.frames === 3 && custom.widths.includes(500),
    `frames: ${custom.frames}, widths: ${custom.widths.join(', ')}`,
  );

  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1500)); // document_idle; Offen-Flag oeffnet selbst
  // Die UI war vor dem Reload offen — das sessionStorage-Flag muss sie
  // ohne erneuten Toggle wiederherstellen.
  const autoReopened = await page.evaluate(() => !!document.getElementById('inkspect-root'));
  check('UI bleibt nach Seiten-Reload offen', autoReopened);
  await page.evaluate(() => {
    if (!document.getElementById('inkspect-root')) {
      window.dispatchEvent(new Event('inkspect:toggle'));
    }
  });
  await page
    .waitForFunction(
      () =>
        document.getElementById('inkspect-root')?.shadowRoot?.querySelectorAll('iframe').length >= 3,
      { timeout: 8000 },
    )
    .catch(() => {});
  const persisted = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root')?.shadowRoot;
    if (!sr) return { frames: 0, widths: [], menuHasCustom: false };
    const frames = [...sr.querySelectorAll('iframe')];
    sr.querySelector('.add-device > button')?.click();
    await new Promise((r) => setTimeout(r, 150));
    const names = [...sr.querySelectorAll('.menu__item-name')].map((n) => n.textContent);
    return {
      frames: frames.length,
      widths: frames.map((f) => Number(f.width)),
      menuHasCustom: names.includes('Kiosk'),
    };
  });
  check(
    'Setup persistiert (Grid + Custom-Preset nach Reload)',
    persisted.frames === 3 && persisted.widths.includes(500) && persisted.menuHasCustom,
    `frames: ${persisted.frames}, widths: ${persisted.widths.join(', ')}, Preset: ${persisted.menuHasCustom}`,
  );

  // --- 15b. Drag&Drop sortiert die Device-Karten um ---
  // Synthetische DragEvents (ohne dataTransfer) reichen: dragstart auf Karte
  // A, dragover auf Karte B sortiert live um, dragend beendet den Zug.
  const dndOrder = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const before = [...sr.querySelectorAll('.device')].map((d) => d.dataset.uid);
    const [cardA, cardB] = [...sr.querySelectorAll('.device')];
    cardA.dispatchEvent(new DragEvent('dragstart', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    // Maus in der HINTEREN Haelfte von Karte B → A landet hinter B.
    const rect = cardB.getBoundingClientRect();
    cardB.dispatchEvent(
      new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: rect.right - 5,
        clientY: rect.top + rect.height / 2,
      }),
    );
    await new Promise((r) => setTimeout(r, 60));
    const dragging = sr.querySelectorAll('.device--dragging').length;
    cardA.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const after = [...sr.querySelectorAll('.device')].map((d) => d.dataset.uid);
    return { before, after, dragging };
  });
  check(
    'Drag&Drop sortiert Devices um',
    dndOrder.dragging === 1 &&
      dndOrder.after.length === dndOrder.before.length &&
      dndOrder.after[0] === dndOrder.before[1] &&
      dndOrder.after[1] === dndOrder.before[0],
    `vorher: ${dndOrder.before.join(',')} | nachher: ${dndOrder.after.join(',')}`,
  );

  // --- 16. Multi-Page-Screenshot-Export ---
  // Aktuelle Seite ist /legacy (1 Marker), auf / liegen 4 offene Marker —
  // der Export muss fuer beide Seiten navigieren und je eine Datei liefern.
  // Genau dieser Flow schlug frueher fehl (waitForPage zu streng, Capture-
  // Fehler als unbehandelte Exception).
  await page.evaluate(() => {
    // Menue aus Test 15 schliessen, damit der Export-Button klickbar ist.
    document.getElementById('inkspect-root').shadowRoot.querySelector('.menu-backdrop')?.click();
  });
  const multiDir = mkdtempSync(join(tmpdir(), 'inkspect-e2e-multi-'));
  const cdpMulti = await page.createCDPSession();
  await cdpMulti.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: multiDir });

  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.share-btn--alt')?.click();
  });
  await page
    .waitForFunction(() => {
      const sr = document.getElementById('inkspect-root').shadowRoot;
      return [...sr.querySelectorAll('.share-hint')].some((n) =>
        n.textContent.includes('Downloads'),
      );
      // 2 Seiten × ~7 Slices × 600 ms plus Navigation
    }, { timeout: 90000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 800));

  const multiFiles = readdirSync(multiDir).filter((f) => f.endsWith('.png'));
  check(
    'Multi-Page-Screenshot-Export (2 Seiten)',
    multiFiles.includes('inkspect-feedback-legacy-iphone-se.png') &&
      multiFiles.includes('inkspect-feedback-home-iphone-se.png'),
    `dateien: ${multiFiles.join(', ') || 'keine'}`,
  );

  // --- 17. Zeilenfuellendes Grid: Karten spannen die volle Breite auf ---
  // Jede Zeile wird proportional skaliert, bis sie das Grid fuellt; die
  // Summe der Kartenbreiten einer Zeile muss nahe der Grid-Breite liegen.
  const rowFill = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const grid = sr.querySelector('.grid');
    const gridWidth = grid.clientWidth - 40; // 2×20px Padding
    const cards = [...sr.querySelectorAll('.device')].map((d) => d.getBoundingClientRect());
    // Karten der ersten Zeile: gleiche Oberkante wie die erste Karte.
    const firstTop = cards[0]?.top;
    const row = cards.filter((c) => Math.abs(c.top - firstTop) < 2);
    const used = row.reduce((sum, c) => sum + c.width, 0) + (row.length - 1) * 20;
    return { gridWidth, used, cards: row.length };
  });
  check(
    'Grid: Zeile fuellt die volle Breite',
    rowFill.cards >= 1 && Math.abs(rowFill.used - rowFill.gridWidth) < 24,
    `genutzt: ${Math.round(rowFill.used)} von ${Math.round(rowFill.gridWidth)} (${rowFill.cards} Karten)`,
  );

  // --- 18. Vollbild-Modus: Seite ueber das ganze Fenster, Bar + FAB ---
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    [...sr.querySelectorAll('.toolbar .icon-btn')]
      .find((b) => b.title.startsWith('Full window'))
      ?.click();
  });
  await page
    .waitForFunction(() => {
      const sr = document.getElementById('inkspect-root').shadowRoot;
      const f = sr.querySelector('.fs-stage iframe');
      try { return f?.contentDocument?.readyState === 'complete'; }
      catch { return false; }
    }, { timeout: 8000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  const fs = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const iframe = sr.querySelector('.fs-stage iframe');
    return {
      stage: !!sr.querySelector('.fs-stage'),
      frameWidth: iframe ? Number(iframe.width) : 0,
      windowWidth: window.innerWidth,
      bar: !!sr.querySelector('.fsbar'),
      fab: !!sr.querySelector('.fs-fab'),
      toolbarGone: !sr.querySelector('.toolbar'),
    };
  });
  check(
    'Vollbild-Modus (Frame in Fenstergroesse, Bar + FAB, keine Toolbar)',
    fs.stage &&
      fs.bar &&
      fs.fab &&
      fs.toolbarGone &&
      Math.abs(fs.frameWidth - fs.windowWidth) < 4,
    `frame: ${fs.frameWidth}, fenster: ${fs.windowWidth}, bar: ${fs.bar}, fab: ${fs.fab}`,
  );

  // FAB toggelt das Feedback-Panel; im Vollbild schwebt es ueber der Seite.
  const fsPanel = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const openBefore = !!sr.querySelector('.panel--right');
    sr.querySelector('.fs-fab').click();
    await new Promise((r) => setTimeout(r, 200));
    const afterFirst = !!sr.querySelector('.panel--right');
    sr.querySelector('.fs-fab').click();
    await new Promise((r) => setTimeout(r, 200));
    const afterSecond = !!sr.querySelector('.panel--right');
    return { toggled: afterFirst !== openBefore && afterSecond === openBefore };
  });
  check('Vollbild: FAB toggelt das Feedback-Panel', fsPanel.toggled);

  // Vollbild verlassen (letzter Button der Bar) — Grid und Toolbar kommen wieder.
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const buttons = sr.querySelectorAll('.fsbar .icon-btn');
    buttons[buttons.length - 1].click();
  });
  await new Promise((r) => setTimeout(r, 500));
  const fsExit = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return {
      toolbar: !!sr.querySelector('.toolbar'),
      grid: !!sr.querySelector('.grid'),
      stage: !!sr.querySelector('.fs-stage'),
    };
  });
  check(
    'Vollbild verlassen stellt das Grid wieder her',
    fsExit.toolbar && fsExit.grid && !fsExit.stage,
    `toolbar: ${fsExit.toolbar}, grid: ${fsExit.grid}`,
  );
} catch (e) {
  results.push(`ERROR ${e.message}`);
} finally {
  await browser.close();
  server.close();
}

console.log(results.join('\n'));
process.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0);
