/**
 * E2E verification of the Inkspect sync against real Chrome: scrolling,
 * clicking (shadow DOM included), typing and hovering (JS + CSS :hover) in
 * frame 1 have to arrive in the other frames; the comment pin has to open its
 * note popup. CDP input produces isTrusted=true.
 */
import http from 'node:http';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';

/**
 * Pull the images out of an exported PDF. Since the switch to `buildPdf` the
 * export no longer produces a PNG; the capture sits inside as a
 * `/FlateDecode` XObject in raw RGB. Order per page: first the header bar or
 * the caption, then the capture.
 */
function pdfImages(file) {
  const buf = readFileSync(file);
  const latin = buf.toString('latin1');
  const out = [];
  const re = /\/Subtype \/Image \/Width (\d+) \/Height (\d+)[^>]*?\/Length (\d+) >>\nstream\n/g;
  let m;
  while ((m = re.exec(latin))) {
    const start = m.index + m[0].length;
    out.push({
      w: +m[1],
      h: +m[2],
      rgb: inflateSync(buf.subarray(start, start + +m[3])),
    });
  }
  return out;
}

/** Page count of a PDF (the page tree). */
function pdfPageCount(file) {
  const m = /\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(
    readFileSync(file).toString('latin1'),
  );
  return m ? Number(m[1]) : 0;
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EXT = new URL('../.output/chrome-mv3', import.meta.url).pathname;

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
  <!-- Ankerpunkt tief in der Seite fuer die Scrollstand-Uebernahme; ohne
       Hintergrund und Text, damit die Screenshot-Pruefungen ihn nicht sehen. -->
  <div id="deep" style="position:absolute;top:1500px;left:0;width:300px;height:60px"></div>
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
  // /sub answers with a delay — that makes the loading bar observable.
  const delay = req.url === '/sub' ? 600 : 0;
  setTimeout(() => res.end(PAGE_HTML), delay);
});
await new Promise((r) => server.listen(8973, r));

// Chrome >= 137 (stable branding) ignores --load-extension; the supported
// route is installExtension() over the debugging pipe.
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  pipe: true,
  enableExtensions: true,
  /**
   * A real window size rather than an emulated viewport.
   *
   * `defaultViewport` sets the layout viewport via CDP emulation but leaves the
   * browser window at its default size. `captureVisibleTab`, however,
   * photographs the *window* — so the screenshot came in at 756×469 while the
   * page believed it was 1600×1000. The crop worked in CSS pixels of the
   * emulated viewport and therefore hit entirely different places in the image:
   * the upshot was our own progress indicator in every slice instead of the
   * page content. Not a fault of the extension — only with `--window-size` do
   * window and viewport measure the same thing.
   */
  defaultViewport: null,
  /**
   * 1280×800 rather than larger: since the captures really hit the viewport
   * (see above), the export's memory use depends directly on this area — three
   * frames, 4000 px of page height, one full-window image per slice.
   *
   * Note: on a machine with many Chrome windows open, the run still falls over
   * during the multi-page export (`Killed: 9`). Smaller windows and flags like
   * `--disable-gpu` made no difference; the only thing that helps is freeing
   * memory beforehand.
   */
  args: ['--window-size=1280,800'],
});
await browser.installExtension(EXT);

const results = [];
/**
 * Print the result immediately *and* collect it. Immediately, because the run
 * takes several minutes and can break off along the way (Chrome gone, port
 * taken, killed by the system) — until then nothing was in the log and you did
 * not even know how far it had got. The collected list remains for the summary
 * at the end.
 */
/** The run cleans up after itself — suppresses the exit message. */
let closing = false;
const check = (name, ok, detail = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`;
  results.push(line);
  console.log(line);
};

try {
  const page = await browser.newPage();
  /**
   * If the renderer dies or the connection to Chrome breaks, the run otherwise
   * hangs silently in the next `waitForFunction` and all you see is a truncated
   * log. These three lines say *that* and *when* it happened — they replace no
   * diagnosis, but they are what makes one possible.
   */
  page.on('error', (e) => console.log(`\n!! Renderer weg: ${e.message}\n`));
  page.on('pageerror', (e) => console.log(`!! Seitenfehler: ${e.message}`));
  browser.on('disconnected', () => {
    // At the end the run closes Chrome itself — only an exit *before* that is
    // worth reporting.
    if (!closing) console.log('\n!! Verbindung zu Chrome verloren\n');
  });
  // For the copy-to-clipboard test of the share link.
  await browser
    .defaultBrowserContext()
    .overridePermissions('http://localhost:8973', ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'])
    .catch(() => {});
  await page.goto('http://localhost:8973/', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800)); // document_idle des Content-Scripts

  // A fresh install opens the welcome page in a tab of its own (see onInstalled
  // in background.ts). That would push the test tab into the background — where
  // no requestAnimationFrame runs any more, and every waitForFunction (default
  // polling: raf) would time out. So away with it, and the test tab to the
  // front.
  for (const p of await browser.pages()) {
    if (p !== page) await p.close().catch(() => {});
  }
  await page.bringToFront();

  // Open Inkspect (toggle event that does not need the SW)
  await page.evaluate(() => window.dispatchEvent(new Event('inkspect:toggle')));

  // A first start opens in full window mode (the startFullscreen default). The
  // sync tests need the grid: dismiss the coachmark, leave full window mode.
  await page.waitForFunction(() => {
    const sr = document.getElementById('inkspect-root')?.shadowRoot;
    return !!sr?.querySelector('.fs-stage iframe');
  }, { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.tour__head .icon-btn')?.click();
    sr.querySelector('.fsbar__exit')?.click(); // Knopf im Dock = Vollbild verlassen
  });
  await page.waitForFunction(
    () => document.getElementById('inkspect-root')?.shadowRoot?.querySelectorAll('iframe').length >= 2,
    { timeout: 5000 },
  );

  // Wait until all frames have loaded
  await page.waitForFunction(() => {
    const frames = document.getElementById('inkspect-root').shadowRoot.querySelectorAll('iframe');
    return [...frames].every((f) => {
      try { return f.contentDocument?.readyState === 'complete' && f.contentDocument.body; }
      catch { return false; }
    });
  }, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 500));

  // On first start the onboarding tour runs and dims everything except the
  // element being explained — its panes catch the tests' clicks. Dismiss it
  // like a user who skips it.
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.tour__head .icon-btn')?.click();
  });
  await page.waitForFunction(
    () => !document.getElementById('inkspect-root').shadowRoot.querySelector('.tour__card'),
    { timeout: 3000 },
  );

  const frameInfo = await page.evaluate(() => {
    const frames = [...document.getElementById('inkspect-root').shadowRoot.querySelectorAll('iframe')];
    return frames.map((f) => {
      const r = f.getBoundingClientRect();
      return { left: r.left, top: r.top, scale: r.width / f.width };
    });
  });
  check('Default-Devices (iPhone SE + Desktop HD)', frameInfo.length === 2, `${frameInfo.length} frames`);

  // --- 0b. Omnibox: the domain is fixed, only the path is editable ---
  // The path starts as a display chip; only a click makes it editable.
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.toolbar__path')?.click();
  });
  await new Promise((r) => setTimeout(r, 80));
  const omni = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const result = {
      origin: sr.querySelector('.omnibox__origin')?.textContent,
      path: sr.querySelector('.omnibox__input')?.value,
    };
    // Leave edit mode again, so the rest of the tests see the chip.
    sr.querySelector('.omnibox__input')?.blur();
    return result;
  });
  check(
    'Omnibox: Domain fix, Pfad editierbar',
    omni.origin === 'localhost:8973' && omni.path === '/',
    `origin: ${omni.origin}, path: ${omni.path}`,
  );

  // --- 0c. "More" menu: opens in the viewport, sync rows switch individually ---
  // Every secondary function (sync included) now sits bundled in the More menu.
  const syncMenu = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    // By class, not by label: since the tooltip rework the button texts run
    // over aria-label.
    const btn = sr.querySelector('.toolbar__more');
    btn.click();
    await new Promise((r) => setTimeout(r, 100));
    const menu = sr.querySelector('.menu');
    if (!menu) return null;
    const rect = menu.getBoundingClientRect();
    const inView =
      rect.top > 40 && rect.bottom < window.innerHeight && rect.left >= 0 && rect.height > 0;
    const rowFor = (label) =>
      [...sr.querySelectorAll('[role="menuitemcheckbox"]')].find(
        (n) => n.textContent.trim() === label,
      );
    const syncLabels = ['Scroll', 'Hover', 'Clicks & inputs'].filter((l) => rowFor(l));
    rowFor('Hover').click();
    await new Promise((r) => setTimeout(r, 100));
    const toggledOff = rowFor('Hover').getAttribute('aria-checked') === 'false';
    rowFor('Hover').click();
    await new Promise((r) => setTimeout(r, 100));
    const restored = rowFor('Hover').getAttribute('aria-checked') === 'true';
    sr.querySelector('.menu-backdrop')?.click();
    await new Promise((r) => setTimeout(r, 60));
    return { inView, syncLabels, toggledOff, restored, closed: !sr.querySelector('.menu') };
  });
  check(
    'More-Menue: Sync-Rows schalten einzeln (im Viewport)',
    syncMenu != null &&
      syncMenu.inView &&
      syncMenu.syncLabels.length === 3 &&
      syncMenu.toggledOff &&
      syncMenu.restored &&
      syncMenu.closed,
    syncMenu
      ? `imViewport: ${syncMenu.inView}, sync: ${syncMenu.syncLabels.join('/')}, toggle: ${syncMenu.toggledOff}/${syncMenu.restored}`
      : 'Menue fehlt',
  );

  // Measure the frame geometry dynamically: the row-filling grid rescales the
  // frames as soon as the available width changes (when the feedback panel
  // opens or closes, say) — static coordinates then go stale.
  const frameRect = (index = 0) =>
    page.evaluate((i) => {
      const f = [
        ...document.getElementById('inkspect-root').shadowRoot.querySelectorAll('iframe'),
      ][i];
      const r = f.getBoundingClientRect();
      return { left: r.left, top: r.top, scale: r.width / f.width, logicalWidth: Number(f.width) };
    }, index);
  const inFrame0 = async (x, y) => {
    const f = await frameRect(0);
    return { x: f.left + x * f.scale, y: f.top + y * f.scale };
  };
  const inFrame1 = async (x, y) => {
    const f = await frameRect(1);
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

  // --- 1. Scroll sync: wheel over frame 1 ---
  const mid = await inFrame0(180, 400);
  await page.mouse.move(mid.x, mid.y);
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel({ deltaY: 400 });
    await new Promise((r) => setTimeout(r, 120));
  }
  await new Promise((r) => setTimeout(r, 600));
  const scrolls = await readAll('doc.scrollingElement.scrollTop');
  check('Scroll-Sync', scrolls.every((s) => s > 100), `scrollTop: ${scrolls.join(', ')}`);

  // Scroll back for stable click coordinates
  await page.evaluate(() => {
    const frames = [...document.getElementById('inkspect-root').shadowRoot.querySelectorAll('iframe')];
    for (const f of frames) f.contentDocument.scrollingElement.scrollTop = 0;
  });
  await new Promise((r) => setTimeout(r, 400));

  // --- 1b. Touch mode: mobile devices start with touch, desktop without ---
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

  // --- 1c. Touch pan: dragging in the touch frame scrolls the page ---
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

  // --- 1d. Touch frames send no hover to the other frames ---
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

  // Switch touch off on the iPhone — the tests that follow expect mouse behaviour.
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelectorAll('.device__touch')[0].click();
  });
  await new Promise((r) => setTimeout(r, 200));

  // --- 2. Click sync: menu button in frame 1 ---
  const btn = await inFrame0(150, 30);
  await page.mouse.click(btn.x, btn.y);
  await new Promise((r) => setTimeout(r, 400));
  const menus = await readAll('doc.body.classList.contains("menu-open")');
  check('Klick-Sync (Burger-Menu)', menus.every(Boolean), `menu-open: ${menus.join(', ')}`);

  // --- 3. Input sync: type into the field ---
  const input = await inFrame0(150, 90);
  await page.mouse.click(input.x, input.y);
  await page.keyboard.type('Hallo Welt', { delay: 30 });
  await new Promise((r) => setTimeout(r, 400));
  const values = await readAll('doc.getElementById("name").value');
  check('Input-Sync', values.every((v) => v === 'Hallo Welt'), `values: ${values.join(' | ')}`);

  // --- 4. Hover sync: mouse over hoverBox ---
  const hover = await inFrame0(150, 150);
  await page.mouse.move(hover.x, hover.y);
  await new Promise((r) => setTimeout(r, 400));
  const hovers = await readAll('doc.getElementById("hoverState").textContent');
  check('Hover-Sync (JS mouseover)', hovers.every((h) => h === 'hovered'), `states: ${hovers.join(', ')}`);

  // --- 5. CSS :hover sync: computed background of the hoverBox ---
  const bgs = await readAll(
    'doc.defaultView.getComputedStyle(doc.getElementById("hoverBox")).backgroundColor',
  );
  check('Hover-Sync (CSS :hover)', bgs.every((b) => b === 'rgb(255, 0, 0)'), `bg: ${bgs.join(' | ')}`);

  // --- 5b. Hover releases when the pointer leaves the frame ---
  // Without the mouseout reset, the simulated :hover would stay stuck in the
  // target frames (no further mouseover is coming).
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

  // --- 6. Click sync inside shadow DOM ---
  const shadow = await inFrame0(150, 250);
  await page.mouse.click(shadow.x, shadow.y);
  await new Promise((r) => setTimeout(r, 400));
  const shadowStates = await readAll('doc.getElementById("shadowState").textContent');
  check(
    'Klick-Sync (Shadow DOM)',
    shadowStates.every((s) => s === 'shadow-clicked'),
    `states: ${shadowStates.join(', ')}`,
  );

  // --- 7. Comment pin: the popup opens, the note lands in the panel ---
  // The palette is a context menu: a right-click on the grid opens it next to
  // the mouse, picking a tool closes it again. Keyboard shortcuts would arrive
  // at the focused iframe, not at the top window.
  // Button order: 0 cursor (interact), 1 element, 2 pin, 3 pen, …
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
      sr.querySelectorAll('.palette:not(.fsbar) .icon-btn')[i].click();
    }, index);
  };

  // --- 6b. The palette appears next to the mouse on a right-click ---
  await openPalette(320, 260);
  await new Promise((r) => setTimeout(r, 80));
  const paletteInfo = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const el = sr.querySelector('.palette:not(.fsbar)');
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
    return sr.querySelector('.palette:not(.fsbar)') == null;
  });
  check(
    'Palette oeffnet per Rechtsklick neben der Maus',
    paletteInfo != null &&
      Math.abs(paletteInfo.left - 326) < 30 &&
      Math.abs(paletteInfo.top - 270) < 30 &&
      paletteClosed,
    `pos: ${paletteInfo ? `${Math.round(paletteInfo.left)},${Math.round(paletteInfo.top)}` : 'fehlt'}, geschlossen: ${paletteClosed}`,
  );

  // A right-click *inside* a preview picks the element under the cursor
  // directly and opens its edit popup (element picker). A second right-click on
  // the same element closes it (toggle).
  const framePick = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const iframe = sr.querySelector('iframe');
    const rightClick = () =>
      iframe.contentDocument.body.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 150 }),
      );
    rightClick(); // (100,150) sits on #hoverBox
    await new Promise((r) => setTimeout(r, 150));
    const popup = sr.querySelector('.anno__inspect');
    const label = popup?.textContent ?? '';
    const paletteOpen = !!sr.querySelector('.palette:not(.fsbar)');
    rightClick();
    await new Promise((r) => setTimeout(r, 150));
    const closed = !sr.querySelector('.anno__inspect');
    return { popup: !!popup, label: label.slice(0, 60), paletteOpen, closed };
  });
  check(
    'Rechtsklick in der Vorschau pickt das Element (Popup + Toggle)',
    framePick.popup && !framePick.paletteOpen && framePick.closed &&
      framePick.label.includes('hoverBox'),
    `popup: ${framePick.popup}, palette: ${framePick.paletteOpen}, zu: ${framePick.closed}, label: ${framePick.label}`,
  );

  await pickTool(2); // Pin
  // The panel slides open with the first entry — here we only wait until the
  // palette has closed.
  await new Promise((r) => setTimeout(r, 400));
  const pinSpot = await inFrame0(180, 350);
  await page.mouse.click(pinSpot.x, pinSpot.y);
  await new Promise((r) => setTimeout(r, 300));

  // --- 7-0. After placing one, the tool jumps back to interact ---
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

  /**
   * Switch the view ("My edits" — markings *and* applied changes) on and off
   * reliably.
   *
   * `showEdits` is **on** by default (`lib/settings.ts`), so asking for `true`
   * is usually a no-op — the handle stays because a leftover off-state would
   * otherwise leave markers to the hover exception alone
   * (`effectiveMarkersVisible` in `components/App.tsx`), and every marker test
   * would measure wherever the mouse happens to be.
   */
  const setEdits = async (on) => {
    // Pointer away from the panel, or `aria-pressed` shows the hover view.
    await page.mouse.move(20, 20);
    await new Promise((r) => setTimeout(r, 150));
    return page.evaluate(async (want) => {
      const sr = document.getElementById('inkspect-root').shadowRoot;
      // On the grid the switch sits in the tool bar, in full window mode in the
      // dock's palette — both carry the same `data-hint`.
      const btn =
        sr.querySelector('.toolbar [data-hint="edits"]') ??
        sr.querySelector('[data-hint="edits"]');
      if (!btn) return false;
      if (btn.getAttribute('aria-pressed') !== String(want)) {
        btn.click();
        await new Promise((r) => setTimeout(r, 250));
      }
      return btn.getAttribute('aria-pressed') === String(want);
    }, on);
  };

  // --- 7b. The note stands permanently at the marker, hover replaces it ---
  // It used to appear only on hover; now a shortened version hangs at the
  // marker permanently and hover replaces it with the full text. So we check
  // that it is there both times — and that only ONE bubble ever renders: the
  // permanent and the hover version must not overlap (the overlay filters the
  // hovered one out of the permanent list).
  const countBubbles = () =>
    page.evaluate(() => {
      const texts = [
        ...document.getElementById('inkspect-root').shadowRoot.querySelectorAll('.anno__svg text'),
      ].map((t) => t.textContent);
      return { n: texts.filter((t) => t === 'Logo zu klein').length, texts };
    });
  const markingsOn = await setEdits(true);
  await page.mouse.move(pinSpot.x + 120, pinSpot.y + 60);
  await new Promise((r) => setTimeout(r, 200));
  const bubbleAway = await countBubbles();
  await page.mouse.move(pinSpot.x, pinSpot.y);
  await new Promise((r) => setTimeout(r, 300));
  const bubbleOn = await countBubbles();
  check(
    'Notiz steht dauerhaft am Marker, ohne sich beim Hover zu verdoppeln',
    markingsOn && bubbleAway.n === 1 && bubbleOn.n === 1,
    `Markierungen an: ${markingsOn}, abseits: ${bubbleAway.n} [${bubbleAway.texts.join('¦')}], ` +
      `auf Marker: ${bubbleOn.n} [${bubbleOn.texts.join('¦')}]`,
  );

  // --- 7c. The view switch hides every marking ---
  // It sits in the tool bar (`data-hint="edits"`), no longer in the panel
  // header — the first button there is now the ⋯ menu.
  await setEdits(true);
  await page.mouse.move(20, 20); // hovering the panel would show the markers anyway
  await new Promise((r) => setTimeout(r, 150));
  const eyeToggle = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const btn = sr.querySelector('.toolbar [data-hint="edits"]');
    if (!btn) return { hidden: -1, shown: -1, switches: -1, legacy: -1 };
    btn.click(); // off
    await new Promise((r) => setTimeout(r, 250));
    const hidden = sr.querySelectorAll('.anno__svg circle').length;
    btn.click(); // wieder an
    await new Promise((r) => setTimeout(r, 250));
    const shown = sr.querySelectorAll('.anno__svg circle').length;
    return {
      hidden,
      shown,
      // Es ist *ein* Schalter: der alte Changes-Knopf darf nirgends mehr
      // stehen, und der neue nur einmal (Toolbar oder fsbar, nie beide).
      switches: sr.querySelectorAll('[data-hint="edits"]').length,
      legacy: sr.querySelectorAll('[data-hint="changes"], [data-hint="markings"]').length,
    };
  });
  check(
    '"My edits" blendet die Marker aus',
    eyeToggle.hidden === 0 && eyeToggle.shown === 1,
    `ausgeblendet: ${eyeToggle.hidden}, wieder an: ${eyeToggle.shown}`,
  );
  check(
    'Ein einziger Ansichts-Schalter (Markings/Changes zusammengelegt)',
    eyeToggle.switches === 1 && eyeToggle.legacy === 0,
    `edits: ${eyeToggle.switches}, alte Schalter: ${eyeToggle.legacy}`,
  );

  // --- 7d. A panel click jumps to the marker: flash on marker and device ---
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

  // --- 7e. The device badge highlights the panel group ---
  const badgeFlash = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.device__anno-count')?.click();
    await new Promise((r) => setTimeout(r, 250));
    return !!sr.querySelector('.fb-group--flash');
  });
  check('Device-Badge flasht die Panel-Gruppe', badgeFlash);

  // --- 7f. The note is editable in the panel (change it and set it back) ---
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

  // --- 7g. Double-clicking a marker opens the note editor in the viewport ---
  // In interaction mode the clicks land in the frame; the app hit-tests the
  // marker bounds and opens the editor with the existing text.
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
  // Scroll the frames back to 0 — the hit test works in document coordinates,
  // and any leftover scroll would shift the click point.
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
  // Second double-click: the editor shows the new text — then set it back, so
  // the follow-up tests find the state they know.
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

  // --- 7g. Hovering a panel entry highlights the marker in the viewport ---
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

  // Starting state: reset the scroll (the marker jump scrolled) and let the
  // flash animations run out.
  await new Promise((r) => setTimeout(r, 1600));
  await page.evaluate(() => {
    const frames = [...document.getElementById('inkspect-root').shadowRoot.querySelectorAll('iframe')];
    for (const f of frames) f.contentDocument.scrollingElement.scrollTop = 0;
  });
  await new Promise((r) => setTimeout(r, 400));

  // --- 8. Element picker: hover highlights, a click takes the element ---
  await pickTool(1); // Element-Picker
  const elSpot = await inFrame0(150, 90); // sits on <input id="name">
  await page.mouse.move(elSpot.x, elSpot.y);
  await new Promise((r) => setTimeout(r, 250));
  const hoverRects = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return sr.querySelectorAll('.anno__svg rect').length;
  });
  await page.mouse.click(elSpot.x, elSpot.y);
  await new Promise((r) => setTimeout(r, 300));
  /**
   * Merely grabbing the element creates *no* marker: the save button stays off
   * for as long as there is neither a note nor a change (`canCommit` in
   * `components/InspectPanel.tsx`) — the disabled button even names the
   * condition itself. So type a note like a user would, and then save.
   */
  const committed = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const note = sr.getElementById('anno-note-in');
    if (!note) return { note: false, cta: false };
    // React does not see a direct `value =` — only the prototype setter, and
    // specifically the one of the matching element (textarea or input).
    const proto = note.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(note, 'Feld zu schmal');
    note.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const cta = sr.querySelector('.anno__inspect-cta');
    const enabled = !!cta && !cta.disabled;
    cta?.click();
    return { note: true, cta: enabled };
  });
  await new Promise((r) => setTimeout(r, 400));
  const elLabels = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    // With a note it stands in the main line and the selector below it.
    return [...sr.querySelectorAll('.fb-item')].map((li) => li.textContent ?? '');
  });
  check(
    'Element-Picker (Hover + Klick)',
    hoverRects >= 1 && committed.cta && elLabels.some((t) => t.includes('input#name')),
    `hoverRects: ${hoverRects}, Notizfeld: ${committed.note}, Knopf aktiv: ${committed.cta}, ` +
      `Eintraege: ${elLabels.length}`,
  );

  // --- 8a. An element marker is NOT mirrored onto other viewports ---
  // The marker lies only on the device it was placed on (iPhone SE); in the
  // second frame no replica and no group of its own may appear.
  const elSync = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return {
      items: [...sr.querySelectorAll('.fb-item')].filter((li) =>
        (li.textContent ?? '').includes('input#name'),
      ).length,
      groups: [...sr.querySelectorAll('.fb-group__name')].map((n) => n.textContent),
    };
  });
  check(
    'Element-Marker nur auf dem gezeichneten Device (kein Sync)',
    elSync.items === 1 && !elSync.groups.includes('Desktop HD'),
    `Eintraege: ${elSync.items}, Gruppen: ${elSync.groups.join(' | ')}`,
  );

  // Deliberately place a marker on the second frame (Desktop HD) — that keeps
  // the multi-device coverage (a screenshot per device, 5 entries) without
  // relying on the element mirroring that was removed. An element marker
  // (rendered as a box, not a pin circle) leaves the pin numbering of later
  // tests unchanged.
  await pickTool(1); // Element-Picker
  const lapSpot = await inFrame1(150, 90); // <input id="name"> im zweiten Frame
  await page.mouse.move(lapSpot.x, lapSpot.y);
  await new Promise((r) => setTimeout(r, 250));
  await page.mouse.click(lapSpot.x, lapSpot.y);
  await new Promise((r) => setTimeout(r, 300));
  // As above: only a note arms the save button.
  await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const note = sr.getElementById('anno-note-in');
    if (!note) return;
    const proto = note.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(note, 'Auch hier zu schmal');
    note.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    sr.querySelector('.anno__inspect-cta')?.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  const lapGroups = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    return [...sr.querySelectorAll('.fb-group__name')].map((n) => n.textContent);
  });
  check(
    'Marker laesst sich auf dem zweiten Frame anlegen',
    lapGroups.includes('Desktop HD'),
    `Gruppen: ${lapGroups.join(' | ')}`,
  );

  // --- 8b. Freehand: crossing strokes merge, no note ---
  // The tool jumps back to interact after every stroke — pick it again before
  // each one.
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
      // Freehand without a note shows "Add note…" as the main line — counting
      // goes by the tool context line.
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

  // --- 8c. Freehand gets a comment in the panel ---
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

  // --- 9. Scrolling in correction mode: wheel over the active overlay ---
  // Arm the pen again; the overlay has to pass wheel events on to the frame
  // rather than swallowing them.
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

  // --- 10. Share link in the panel: build the URL and decode the payload back ---
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
    // 5 entries: pin, element (iPhone + laptop replica), 2× freehand.
    share.items?.length === 5 &&
      share.items.some((i) => i.shape.text === 'Logo zu klein') &&
      share.items.some((i) => i.shape.tool === 'element') &&
      share.items.some((i) => i.shape.note === 'Linie krumm'),
    `items: ${share.items?.length ?? 'keine'}, url: ${share.url.slice(0, 60)}…`,
  );

  // --- 10a. The share link lands straight on the clipboard ---
  const shareCopied = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const hintOk = [...sr.querySelectorAll('.share-hint')].some((n) =>
      n.textContent.includes('copied'),
    );
    let clipboard = '';
    try {
      clipboard = await navigator.clipboard.readText();
    } catch {
      /* headless may refuse read access */
    }
    return { hintOk, clipboardMatches: clipboard.includes('#ink-feedback=') };
  });
  check(
    'Share-Link in Zwischenablage kopiert',
    shareCopied.hintOk,
    `hint: ${shareCopied.hintOk}, clipboard: ${shareCopied.clipboardMatches}`,
  );

  // --- 10b. Screenshot export: annotated full-page PNGs in the downloads folder ---
  // Note the frame scale before the export — the expected image height depends
  // on the row-filling zoom, no longer on a fixed stepper value.
  const exportFrame = await frameRect(0);
  const exportScale = exportFrame.scale;
  const exportLogicalWidth = exportFrame.logicalWidth;
  const downloadDir = mkdtempSync(join(tmpdir(), 'inkspect-e2e-'));
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });

  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.share-btn--alt').click();
  });
  // The export is done once the panel shows the success message.
  await page
    .waitForFunction(() => {
      const sr = document.getElementById('inkspect-root').shadowRoot;
      return [...sr.querySelectorAll('.share-hint')].some((n) =>
        n.textContent.includes('Downloads'),
      );
      // Full page: ~6 slices × 600 ms plus capture time
    }, { timeout: 30000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 600)); // Download zu Ende schreiben lassen

  // The export delivers one PDF per device with feedback; the file name carries
  // host, path slug, device and date.
  const shotFiles = readdirSync(downloadDir).filter((f) => f.endsWith('.pdf'));
  const shotFile = shotFiles.find((f) => f.includes('_home_iphone-se_'));
  check(
    'Screenshots-Export (Datei pro Device mit Feedback)',
    !!shotFile,
    `dateien: ${shotFiles.join(', ') || 'keine'}`,
  );

  // --- 10c. The screenshot shows the markers (coloured pixels from pin/strokes) ---
  let redPixels = 0;
  let darkPixels = 0;
  let purplePixels = 0;
  let shotSize = { w: 0, h: 0 };
  if (shotFile) {
    // Image 0 is the header bar, image 1 the page capture.
    const shot = pdfImages(join(downloadDir, shotFile))[1];
    if (shot) {
      shotSize = { w: shot.w, h: shot.h };
      for (let i = 0; i < shot.rgb.length; i += 3) {
        const [r, g, b] = [shot.rgb[i], shot.rgb[i + 1], shot.rgb[i + 2]];
        // The default marker colour is the pencil blue #6d8cc0 = rgb(109,140,192),
        // no longer the earlier warning red.
        if (r > 70 && r < 150 && g > 105 && g < 175 && b > 160 && b < 225) redPixels += 1;
        // Note bubble: rgba(14,16,20,.92) over a white page blends to about
        // rgb(33,35,39) — slightly blue-tinted, unlike neutral grey text
        // antialiasing (r==g==b).
        if (Math.abs(r - 33) <= 6 && Math.abs(g - 35) <= 6 && Math.abs(b - 39) <= 7 && b > r) {
          darkPixels += 1;
        }
        // Sticky header of the test page: rgb(140,40,220).
        if (r > 110 && r < 170 && g < 80 && b > 190) purplePixels += 1;
      }
    }
  }

  check('Screenshot zeigt Markierungen', redPixels > 50, `Marker-Pixel: ${redPixels}`);
  check(
    'Screenshot zeigt Notiz-Sprechblase am Marker',
    darkPixels > 100,
    `Sprechblasen-Pixel: ${darkPixels}`,
  );
  // Full page: the test page is 4000 px tall → document height × frame scale.
  // The width also depends on the row-filling zoom (not on a fixed stepper
  // value), so check against the frame's viewport width rather than a fixed
  // pixel count.
  const expectedH = 4000 * exportScale;
  const expectedW = exportLogicalWidth * exportScale;
  check(
    'Screenshot ist Full-Page (ganze Dokumenthoehe)',
    Math.abs(shotSize.h - expectedH) < expectedH * 0.08 &&
      Math.abs(shotSize.w - expectedW) < expectedW * 0.08,
    `${shotSize.w}×${shotSize.h}, erwartet ~${Math.round(expectedW)}×${Math.round(expectedH)}`,
  );
  // The sticky header (40×50 px logical) may appear only ONCE in the image —
  // without suppression it would stand on each of the ~6 slices.
  const headerPx = 40 * 50 * exportScale * exportScale;
  check(
    'Sticky-Header nur einmal im Full-Page-Screenshot',
    purplePixels > headerPx * 0.3 && purplePixels < headerPx * 2.5,
    `violette Pixel: ${purplePixels}, ein Header ~${Math.round(headerPx)}`,
  );

  // --- 10d. Done state: ticking off dims the marker and counts the badge down ---
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

  // Restore the starting state for the follow-up tests
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

  // --- 11. Link sync: a click on <a href> navigates all frames ---
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

  // --- 12. Navigation watchdog: direct navigation without a click event ---
  // location.assign bypasses the click sync entirely — only the watchdog can
  // pull the remaining frames along.
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

  // --- 13. Feedback is bound to a page; an item click jumps across pages ---
  // On /watchdog the markers placed on / must not render; the panel lists them
  // under their page. A click on the entry navigates back and then flies to the
  // marker (flash).
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

  // --- 14. Legacy import: old pen shapes (points instead of strokes) do not crash ---
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
  /**
   * Back to the grid first, then measure. Navigating to /legacy was a fresh
   * session, and that starts in full window mode (the startFullscreen default)
   * — there the feedback hangs off the full-window id, while the imported
   * stroke sits on `iphone-se`. In full window mode it is therefore quite
   * rightly not visible; the measurement was simply taken in the wrong place.
   */
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root')?.shadowRoot;
    if (!sr?.querySelector('.fs-stage')) return;
    sr.querySelector('.fsbar__exit')?.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  // Fresh session: the view switch is back at its default (on). Asserted rather
  // than assumed — off, the overlay would not draw the imported stroke at all.
  const marksOn = await setEdits(true);
  const legacy = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root')?.shadowRoot;
    return {
      open: !!sr,
      crashed: sr ? sr.textContent.includes('Inkspect crashed') : false,
      polylines: sr ? sr.querySelectorAll('.anno__svg polyline').length : 0,
      // Without these three, a "polylines: 0" cannot be interpreted: it could be
      // the import, the hidden state, or the fact that the card carrying the
      // stroke (iphone-se) is not on the grid at all.
      items: sr ? sr.querySelectorAll('.fb-item').length : 0,
      devices: sr ? [...sr.querySelectorAll('.device')].map((d) => d.dataset.uid).join(',') : '',
      fullscreen: sr ? !!sr.querySelector('.fs-stage') : false,
    };
  });
  check(
    'Legacy-Pen-Import ohne Crash',
    legacy.open && !legacy.crashed && legacy.polylines >= 1,
    `open: ${legacy.open}, crashed: ${legacy.crashed}, polylines: ${legacy.polylines}, ` +
      `Eintraege: ${legacy.items}, Marker an: ${marksOn}, Vollbild: ${legacy.fullscreen}, ` +
      `Devices: ${legacy.devices || 'keine'}`,
  );

  // --- 15. Create a custom device; grid + preset survive a reload ---
  await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.add-device > button').click();
    await new Promise((r) => setTimeout(r, 150));
    // React reads values through onChange — a native setter plus an input event is needed.
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
  await new Promise((r) => setTimeout(r, 800)); // the grid save is debounced by 300 ms
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
  // The UI was open before the reload — the sessionStorage flag has to restore
  // it without another toggle.
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

  // --- 15b. Drag and drop reorders the device cards ---
  // Synthetic DragEvents (without dataTransfer) are enough: dragstart on card
  // A, dragover on card B reorders live, dragend ends the drag.
  const dndOrder = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const before = [...sr.querySelectorAll('.device')].map((d) => d.dataset.uid);
    const [cardA, cardB] = [...sr.querySelectorAll('.device')];
    cardA.dispatchEvent(new DragEvent('dragstart', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    // Mouse in the BACK half of card B → A lands behind B.
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

  // --- 16. Multi-page screenshot export ---
  // The current page is /legacy (1 marker), and / carries 4 open markers — the
  // export has to navigate for both pages and deliver one file each. This is
  // exactly the flow that used to fail (waitForPage too strict, capture errors
  // as an unhandled exception).
  await page.evaluate(() => {
    // Close the menu from test 15, so that the export button is clickable.
    document.getElementById('inkspect-root').shadowRoot.querySelector('.menu-backdrop')?.click();
  });
  const multiDir = mkdtempSync(join(tmpdir(), 'inkspect-e2e-multi-'));
  const cdpMulti = await page.createCDPSession();
  await cdpMulti.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: multiDir });

  /**
   * As with the share link: the first click only opens the page selection, and
   * that starts *empty*. Without ticking the other page, the second click
   * exports only the current one — the test used to measure straight past that.
   */
  const multiPick = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const shotBtn = () => sr.querySelector('.share-btn--alt');
    shotBtn()?.click();
    await new Promise((r) => setTimeout(r, 200));
    const opened = !!sr.querySelector('.shotpick');
    sr.querySelector('.shotpick__row:not(.shotpick__row--fixed) .shotpick__input')?.click();
    await new Promise((r) => setTimeout(r, 150));
    const label = shotBtn()?.textContent?.trim() ?? '';
    shotBtn()?.click();
    return { opened, label };
  });
  await page
    .waitForFunction(() => {
      const sr = document.getElementById('inkspect-root').shadowRoot;
      return [...sr.querySelectorAll('.share-hint')].some((n) =>
        n.textContent.includes('Downloads'),
      );
      // 2 pages × ~7 slices × 600 ms plus navigation
    }, { timeout: 120000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 800));

  const multiFiles = readdirSync(multiDir).filter((f) => f.endsWith('.pdf'));
  check(
    'Multi-Page-Screenshot-Export (2 Seiten)',
    multiFiles.some((f) => f.includes('_legacy_iphone-se_')) &&
      multiFiles.some((f) => f.includes('_home_iphone-se_')),
    `auswahl offen: ${multiPick.opened}, knopf: ${multiPick.label}, ` +
      `dateien: ${multiFiles.join(', ') || 'keine'}`,
  );

  // --- 16b. Share link with a page selection (as with the screenshot export) ---
  // The current page is /legacy, and / carries further markers: the first click
  // on "Share as link" must therefore not build a link yet, but open the page
  // selection. Only the second click triggers — and the payload then carries
  // the markers of *both* pages.
  const sharePick = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const shareBtn = () => sr.querySelector('.share-btn:not(.share-btn--alt)');
    shareBtn().click();
    await new Promise((r) => setTimeout(r, 150));
    const head = sr.querySelector('.shotpick__head')?.textContent?.trim() ?? '';
    const opened = !!sr.querySelector('.shotpick') && !sr.querySelector('.share-box');

    // Add the other page — the real field carries the interaction.
    const row = sr.querySelector('.shotpick__row:not(.shotpick__row--fixed) .shotpick__input');
    row?.click();
    await new Promise((r) => setTimeout(r, 120));
    const label = shareBtn().textContent.trim();

    // The second click triggers.
    shareBtn().click();
    await new Promise((r) => setTimeout(r, 500));
    const url = sr.querySelector('.share-box__url')?.value ?? '';
    const closed = !sr.querySelector('.shotpick');
    const match = /#ink-feedback=([A-Za-z0-9_-]+)/.exec(url);
    if (!match) return { opened, head, label, closed, url, pages: null };
    const b64 = match[1].replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const payload = JSON.parse(await new Response(stream).text());
    return {
      opened,
      head,
      label,
      closed,
      url,
      pages: [...new Set(payload.items.map((i) => new URL(i.url).pathname))].sort(),
      count: payload.items.length,
    };
  });
  check(
    'Share-Link: erster Klick oeffnet die Seitenauswahl',
    sharePick.opened && sharePick.head.startsWith('Also share'),
    `offen: ${sharePick.opened}, kopf: ${sharePick.head}`,
  );
  check(
    'Share-Link: Knopf zeigt die Zahl der gewaehlten Seiten',
    sharePick.label === 'Share as link (2)',
    `label: ${sharePick.label}`,
  );
  check(
    'Share-Link traegt die Marker beider Seiten',
    sharePick.closed &&
      sharePick.pages?.length === 2 &&
      sharePick.pages.includes('/') &&
      sharePick.pages.includes('/legacy'),
    `seiten: ${sharePick.pages?.join(', ') ?? 'keine'}, marker: ${sharePick.count ?? 0}`,
  );

  // --- 17. The "Fit" button: cards span the full width ---
  // The zoom otherwise scales the cards directly; "Fit" sets it so that the row
  // fills the grid. The sum of the card widths then has to come close to the
  // grid width.
  // "Fit" now sits in the More menu: open it, click the entry (which closes the menu).
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.toolbar__more')?.click();
  });
  await new Promise((r) => setTimeout(r, 120));
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    [...sr.querySelectorAll('.menu__item')]
      .find((b) => b.textContent.trim() === 'Fit devices to width')
      ?.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  const rowFill = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const grid = sr.querySelector('.grid');
    const gridWidth = grid.clientWidth - 40; // 2×20px Padding
    const cards = [...sr.querySelectorAll('.device')].map((d) => d.getBoundingClientRect());
    // Cards of the first row: same top edge as the first card.
    const firstTop = cards[0]?.top;
    const row = cards.filter((c) => Math.abs(c.top - firstTop) < 2);
    const used = row.reduce((sum, c) => sum + c.width, 0) + (row.length - 1) * 20;
    return { gridWidth, used, cards: row.length };
  });
  /**
   * Two properties, not a pixel count:
   *
   * - **No overflow.** That is the hard condition — if the row overflows, it
   *   wraps and the button has broken its promise.
   * - **Close to it.** Not exact: `fitZoom` rounds the zoom down to whole
   *   percent (it is displayed as a percentage too) and keeps the scrollbar's
   *   width free in case it only appears because of the new card height. With
   *   this set (375 + 1920 + 500 logical) one percent step is already ~28 px —
   *   a tolerance of 24 px was something the button could not possibly meet.
   */
  check(
    'Fit-Knopf fuellt die Zeile auf die volle Breite',
    rowFill.cards >= 1 &&
      rowFill.used <= rowFill.gridWidth &&
      rowFill.used >= rowFill.gridWidth * 0.94,
    `genutzt: ${Math.round(rowFill.used)} von ${Math.round(rowFill.gridWidth)} ` +
      `(${rowFill.cards} Karten, ${Math.round((rowFill.used / rowFill.gridWidth) * 100)} %)`,
  );

  // --- 18. Full window mode: the page across the whole window, bar + FAB ---
  // Full window has a fixed button in the toolbar.
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.toolbar [data-hint="fullscreen"]')?.click();
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
      fab: !!sr.querySelector('.fsbar__feedback'),
      toolbarGone: !sr.querySelector('.toolbar'),
    };
  });
  check(
    'Vollbild-Modus (Frame in Fenstergroesse, Dock mit Feedback, keine Toolbar)',
    fs.stage &&
      fs.bar &&
      fs.fab &&
      fs.toolbarGone &&
      Math.abs(fs.frameWidth - fs.windowWidth) < 4,
    `frame: ${fs.frameWidth}, fenster: ${fs.windowWidth}, bar: ${fs.bar}, fab: ${fs.fab}`,
  );

  // The FAB toggles the feedback panel; in full window mode it floats over the page.
  const fsPanel = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const openBefore = !!sr.querySelector('.panel--right');
    sr.querySelector('.fsbar__feedback').click();
    await new Promise((r) => setTimeout(r, 200));
    const afterFirst = !!sr.querySelector('.panel--right');
    sr.querySelector('.fsbar__feedback').click();
    await new Promise((r) => setTimeout(r, 200));
    const afterSecond = !!sr.querySelector('.panel--right');
    return { toggled: afterFirst !== openBefore && afterSecond === openBefore };
  });
  check('Vollbild: Feedback-Knopf im Dock toggelt das Panel', fsPanel.toggled);

  // Leave full window mode (button in the dock) — grid and toolbar come back.
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.fsbar__exit').click();
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
  // --- 19. Unfolding a hidden element ---
  // The test page hits the case exactly: #menu is display:none and only opens
  // via body.menu-open, set by the click on #menuBtn. A marker inside it points
  // at nothing once it is folded shut — unless the click path recorded when it
  // was created gets replayed.
  const menuState = async () => (await readAll('doc.body.classList.contains("menu-open")'))[0];
  /** Put the menu into the state we want — a real click (isTrusted). */
  const setMenu = async (want) => {
    for (let i = 0; i < 3 && (await menuState()) !== want; i++) {
      const b = await inFrame0(150, 30);
      await page.mouse.click(b.x, b.y);
      await new Promise((r) => setTimeout(r, 400));
    }
    return (await menuState()) === want;
  };

  // Shut first, then open: that guarantees a real click on #menuBtn in the
  // unfold path. If the menu were already open, `setMenu` would not click at
  // all and the pin would get an empty path.
  await setMenu(false);
  const menuOpened = await setMenu(true);

  // Click point taken from the *measured* rectangle of #menu rather than fixed
  // page coordinates: at this point the frames are scrolled far down and have
  // been reordered by drag and drop.
  const menuSpot = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const f = sr.querySelectorAll('iframe')[0];
    f.contentWindow.scrollTo(0, 0);
    const r = f.contentDocument.getElementById('menu').getBoundingClientRect();
    const fr = f.getBoundingClientRect();
    const scale = fr.width / Number(f.width);
    return {
      x: fr.left + (r.left + Math.min(30, r.width / 2)) * scale,
      y: fr.top + (r.top + r.height / 2) * scale,
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  });
  await new Promise((r) => setTimeout(r, 300));

  // Pin on #menu: the anchor is therefore an element that does not exist
  // without the interaction. If the click misses, the pin anchors on the
  // visible body — and then the test below fails, rather than passing for the
  // wrong reason.
  await pickTool(2); // Pin
  await new Promise((r) => setTimeout(r, 400));
  await page.mouse.click(menuSpot.x, menuSpot.y);
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.type('Menuepunkt zu eng', { delay: 20 });
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 400));

  const menuClosed = await setMenu(false);
  const clickedHidden = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const item = [...sr.querySelectorAll('.fb-item')].find((li) =>
      li.textContent.includes('Menuepunkt zu eng'),
    );
    item?.click();
    // Unfolding runs asynchronously: click, settle, remeasure, fly to.
    await new Promise((r) => setTimeout(r, 900));
    return !!item;
  });
  const revealedMenus = await readAll('doc.body.classList.contains("menu-open")');
  check(
    'Panel-Klick klappt das versteckte Element wieder auf',
    menuOpened && menuClosed && clickedHidden && revealedMenus.every(Boolean),
    `eintrag: ${clickedHidden}, vorher zu: ${menuClosed}, #menu: ${menuSpot.w}x${menuSpot.h}, ` +
      `menu-open: ${revealedMenus.join(', ')}`,
  );

  // --- 19b. The menu is standing open from the click above. Switching to a
  // normal entry has to fold it shut again: the unfolded state belongs to the
  // one entry, not to the rest of the session. Otherwise the user ends up in
  // front of a page state they never produced themselves.
  // An entry of *this* page: `.fb-item--static` are the ones of the other
  // pages, and a click on those navigates away — the export below would then
  // photograph the wrong page.
  const clickedNormal = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const own = [...sr.querySelectorAll('.fb-item:not(.fb-item--static)')];
    const item = own.find((li) => !li.textContent.includes('Menuepunkt zu eng'));
    item?.click();
    // Folding shut goes through the same beat as unfolding: click, settle,
    // remeasure.
    await new Promise((r) => setTimeout(r, 900));
    return { hit: !!item, label: item?.textContent?.trim().slice(0, 40) ?? null, own: own.length };
  });
  const collapsedMenus = await readAll('doc.body.classList.contains("menu-open")');
  check(
    'Wechsel auf normales Feedback klappt wieder zu',
    clickedNormal.hit && collapsedMenus.every((m) => m === false),
    `eintrag: ${clickedNormal.label ?? 'keiner'} (von ${clickedNormal.own} auf dieser Seite), ` +
      `menu-open: ${collapsedMenus.join(', ')}`,
  );

  // --- 19c. Detail shot: for the hidden spot the export appends a second PDF
  // page, captured in the unfolded state.
  await setMenu(false);
  // Diagnosis in case the detail page does not appear: which device does the
  // entry sit on, and is #menu invisible at all?
  const detailSetup = await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const groups = [...sr.querySelectorAll('.fb-group')].map((g) => ({
      device: g.querySelector('.fb-group__title, .fb-group__head')?.textContent?.trim() ?? '?',
      hat: [...g.querySelectorAll('.fb-item')].some((li) =>
        li.textContent.includes('Menuepunkt zu eng'),
      ),
    }));
    const f = sr.querySelector('iframe');
    const el = f?.contentDocument?.getElementById('menu');
    return { groups, versteckt: el ? el.getBoundingClientRect().height === 0 : null };
  });
  const detailDir = mkdtempSync(join(tmpdir(), 'inkspect-e2e-detail-'));
  const detailCdp = await page.createCDPSession();
  await detailCdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: detailDir,
  });
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    sr.querySelector('.share-btn--alt').click();
  });
  // With several pages the button first opens the selection — then trigger.
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    if (sr.querySelector('.shotpick__list')) sr.querySelector('.share-btn--alt').click();
  });
  await page
    .waitForFunction(() => {
      const sr = document.getElementById('inkspect-root').shadowRoot;
      return [...sr.querySelectorAll('.share-hint')].some((n) =>
        n.textContent.includes('Downloads'),
      );
    }, { timeout: 120000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));

  // Which device the pin sits on depends on the grid order (which an earlier
  // test changes by drag and drop) — it is enough that *one* of the files
  // carries the extra page.
  const detailFiles = readdirSync(detailDir).filter((f) => f.endsWith('.pdf'));
  const detailInfo = detailFiles.map((f) => ({
    f,
    pages: pdfPageCount(join(detailDir, f)),
    imgs: pdfImages(join(detailDir, f)),
  }));
  // The detail page shows a viewport crop, the base page the whole page — were
  // both the same height, the second would only be a repetition.
  const withDetail = detailInfo.find(
    (d) => d.pages >= 2 && d.imgs.length >= 4 && d.imgs[3].h < d.imgs[1].h / 2,
  );
  check(
    'Screenshot: Detail-Aufnahme fuer verstecktes Element',
    !!withDetail,
    `${detailInfo.map((d) => `${d.f}: ${d.pages}S ${d.imgs.map((i) => i.h).join('/')}`).join(' | ') || 'keine Dateien'}` +
      ` || Eintrag bei: ${detailSetup.groups.filter((g) => g.hat).map((g) => g.device).join(',') || 'nirgends'}` +
      ` (Gruppen: ${detailSetup.groups.map((g) => g.device).join(',')}), #menu versteckt: ${detailSetup.versteckt}`,
  );
  // The export must not leave the page unfolded.
  await new Promise((r) => setTimeout(r, 1200));
  const afterExport = await readAll('doc.body.classList.contains("menu-open")');
  check(
    'Export laesst das Menue nicht offen stehen',
    afterExport.every((m) => m === false),
    `menu-open: ${afterExport.join(', ')}`,
  );

  // Counter-check: a marker on a *visible* element carries the same click path
  // (the menu was open when it was created) but must not replay it. This early
  // exit is exactly what makes the unfiltered recording harmless.
  const closedAgain = await setMenu(false);
  const clickedVisible = await page.evaluate(async () => {
    const sr = document.getElementById('inkspect-root').shadowRoot;
    const item = [...sr.querySelectorAll('.fb-item')].find((li) =>
      li.textContent.includes('Logo zu klein'),
    );
    item?.click();
    await new Promise((r) => setTimeout(r, 900));
    return !!item;
  });
  const stillClosed = await readAll('doc.body.classList.contains("menu-open")');
  check(
    'Sichtbares Element loest kein Aufklappen aus',
    closedAgain && clickedVisible && stillClosed.every((m) => m === false),
    `eintrag: ${clickedVisible}, menu-open: ${stillClosed.join(', ')}`,
  );

  // --- 22. Switching on takes the page's scroll position over ---
  // Close, scroll the tab deep into the page, switch on again: every frame has
  // to open at that spot — not at the top. `#deep` sits at y=1500 and is the
  // anchor; matched by element, the position has to land within a few pixels
  // regardless of how tall the document is in each frame.
  await page.evaluate(() => window.dispatchEvent(new Event('inkspect:toggle')));
  await page.waitForFunction(() => !document.getElementById('inkspect-root'), { timeout: 5000 });
  await page.evaluate(() => window.scrollTo(0, 1500));
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => window.dispatchEvent(new Event('inkspect:toggle')));
  await page
    .waitForFunction(() => {
      const frames = document.getElementById('inkspect-root')?.shadowRoot?.querySelectorAll('iframe');
      if (!frames?.length) return false;
      return [...frames].every((f) => {
        try {
          return f.contentDocument?.readyState === 'complete' && !!f.contentDocument.getElementById('deep');
        } catch { return false; }
      });
    }, { timeout: 10000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  const adopted = await page.evaluate(() => {
    const frames = [...document.getElementById('inkspect-root').shadowRoot.querySelectorAll('iframe')];
    return frames.map((f) => {
      try {
        const doc = f.contentDocument;
        return {
          top: Math.round(doc.scrollingElement.scrollTop),
          anchor: Math.round(doc.getElementById('deep').getBoundingClientRect().top),
        };
      } catch { return null; }
    });
  });
  check(
    'Scrollstand der Seite beim Einschalten uebernommen',
    adopted.length > 0 &&
      adopted.every((f) => f && f.top > 1000 && Math.abs(f.anchor) < 8),
    adopted.map((f) => (f ? `${f.top} (Anker ${f.anchor})` : 'unlesbar')).join(', '),
  );

} catch (e) {
  results.push(`ERROR ${e.message}`);
} finally {
  closing = true;
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.startsWith('PASS'));
console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
if (failed.length) console.log(failed.join('\n'));
process.exit(failed.length ? 1 : 0);
