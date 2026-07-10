import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '@/components/App';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { UI_CSS } from '@/components/styles';
import { addItems } from '@/lib/feedbackStore';
import { decodeShare, extractShareFromHash } from '@/lib/share';
import type { ToggleMessage } from '@/lib/messages';
import { createLogger } from '@/lib/log';

const HOST_ID = 'inkspect-root';

/** Fenster-Event zum Oeffnen/Schliessen — SW-unabhaengig, u. a. fuer Tests. */
export const TOGGLE_EVENT = 'inkspect:toggle';

export default defineContentScript({
  matches: ['*://*/*'],
  // Bewusst per Manifest statt scripting.executeScript registriert — letzteres
  // lehnt das grosse minifizierte Bundle ab ("isn't UTF-8 encoded"). Das Script
  // bleibt dormant (nur Listener), bis der Nutzer das Icon klickt.
  runAt: 'document_idle',
  noScriptStartedPostMessage: true,

  main() {
    const log = createLogger('content');

    // Die Preview-iframes laden dieselbe Origin — ohne den Guard wuerde sich
    // die UI in jedem Frame erneut mounten.
    if (window.top !== window) {
      log.debug('in Sub-Frame geladen — kein Mount', location.href);
      return;
    }

    log.info('content script aktiv auf', location.href);

    let root: Root | null = null;
    let host: HTMLDivElement | null = null;
    let previousOverflow = '';

    function open(withFeedback = false): void {
      if (host) {
        log.debug('open() ignoriert — UI bereits offen');
        return;
      }
      log.info('open UI');

      host = document.createElement('div');
      host.id = HOST_ID;
      // `all: initial` kappt vererbte Seiten-Styles, bevor position/z-index
      // gesetzt werden — die Reihenfolge im cssText ist relevant.
      host.style.cssText =
        'all: initial; position: fixed; inset: 0; z-index: 2147483647;';

      const shadow = host.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = UI_CSS;
      shadow.append(style);

      const container = document.createElement('div');
      shadow.append(container);

      // An documentElement, nicht an body: so greifen Body-Styles der Seite
      // (transform, filter, contain) nicht auf unser position:fixed durch.
      document.documentElement.append(host);

      previousOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';

      root = createRoot(container);
      root.render(
        createElement(
          ErrorBoundary,
          null,
          createElement(App, {
            shadowRoot: shadow,
            onClose: close,
            initialFeedbackOpen: withFeedback,
          }),
        ),
      );
    }

    function close(): void {
      log.info('close UI');
      root?.unmount();
      root = null;
      host?.remove();
      host = null;
      document.documentElement.style.overflow = previousOverflow;
    }

    function toggle(): void {
      if (host) close();
      else open();
    }

    // Aus dem Background (Icon-Klick).
    browser.runtime.onMessage.addListener((message) => {
      if ((message as ToggleMessage)?.type !== 'ink:toggle') return;
      log.debug('toggle empfangen, offen?', !!host);
      toggle();
    });

    // SW-unabhaengiger Ausloeser (Tests, spaeter evtl. Tastenkuerzel).
    window.addEventListener(TOGGLE_EVENT, () => {
      log.debug('toggle via window-event, offen?', !!host);
      toggle();
    });

    // Empfaenger-Flow des Feedback-Teilens: haengt im Hash ein
    // #ink-feedback=…-Payload, wird es importiert und die UI oeffnet sich
    // direkt mit dem Feedback-Panel.
    const shared = extractShareFromHash(location.hash);
    if (shared) {
      void decodeShare(shared)
        .then(async (items) => {
          const added = await addItems(items);
          log.info('geteiltes Feedback importiert', { total: items.length, neu: added });
          // Hash entfernen, damit Reload/Copy der URL den Payload nicht schleppt.
          history.replaceState(null, '', location.pathname + location.search);
          open(true);
        })
        .catch((e: unknown) => log.error('geteiltes Feedback unlesbar', e));
    }

    log.debug('content script bereit (dormant)');
  },
});
