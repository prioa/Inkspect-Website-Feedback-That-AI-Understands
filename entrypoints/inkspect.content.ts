import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '@/components/App';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { UI_CSS } from '@/components/styles';
import { addItems } from '@/lib/feedbackStore';
import { decodeShare, extractShareFromHash } from '@/lib/share';
import { captureScrollAnchor } from '@/lib/scrollAnchor';
import type { ToggleMessage } from '@/lib/messages';
import { createLogger } from '@/lib/log';

const HOST_ID = 'inkspect-root';

/** Window event for opening/closing — independent of the SW, used by tests. */
export const TOGGLE_EVENT = 'inkspect:toggle';

/**
 * Open state per tab: sessionStorage survives F5/reload (the content script
 * dies with it) but stays tab-local and disappears with the tab. Some pages
 * block access to it (sandbox) — hence the guards everywhere.
 */
const OPEN_FLAG = 'ink-ui-open';
/** The page last opened in the previews — App.tsx writes it. */
const PAGE_KEY = 'ink-ui-page';

export default defineContentScript({
  matches: ['*://*/*'],
  // Registered via the manifest rather than scripting.executeScript on
  // purpose — the latter rejects the large minified bundle ("isn't UTF-8
  // encoded"). The script stays dormant (listeners only) until the user
  // clicks the icon.
  runAt: 'document_idle',
  noScriptStartedPostMessage: true,

  main() {
    const log = createLogger('content');

    // The preview iframes load the same origin — without the guard the UI
    // would mount itself again in every frame.
    if (window.top !== window) {
      log.debug('loaded in a sub-frame — not mounting', location.href);
      return;
    }

    log.info('content script active on', location.href);

    let root: Root | null = null;
    let host: HTMLDivElement | null = null;
    let previousOverflow = '';

    function open(withFeedback = false): void {
      if (host) {
        log.debug('open() ignored — the UI is already open');
        return;
      }
      log.info('open UI');

      // Where the page stands *now* — measured before anything of ours is in
      // the document: the overlay would sit in front of every reading point,
      // and `overflow: hidden` below takes the scrollbar away. The previews
      // start at this position (see `lib/scrollAnchor`).
      const scroll = captureScrollAnchor(window);
      if (scroll) log.debug('Scroll position carried over', scroll.ratioY, scroll.path.join(' >>> '));

      try {
        sessionStorage.setItem(OPEN_FLAG, withFeedback ? 'feedback' : '1');
      } catch {
        /* The page blocks sessionStorage */
      }

      // Report the active state to the toolbar icon ("ON" badge).
      void browser.runtime
        .sendMessage({ type: 'ink:ui-state', open: true })
        .catch(() => undefined);

      host = document.createElement('div');
      host.id = HOST_ID;
      // `all: initial` cuts inherited page styles before position/z-index are
      // set — the order within cssText matters.
      host.style.cssText =
        'all: initial; position: fixed; inset: 0; z-index: 2147483647;';

      const shadow = host.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = UI_CSS;
      shadow.append(style);

      const container = document.createElement('div');
      shadow.append(container);

      // On documentElement, not on body: that way the page's body styles
      // (transform, filter, contain) cannot reach through to our position:fixed.
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
            initialScroll: scroll,
          }),
        ),
      );
    }

    function close(): void {
      log.info('close UI');
      void browser.runtime
        .sendMessage({ type: 'ink:ui-state', open: false })
        .catch(() => undefined);
      try {
        sessionStorage.removeItem(OPEN_FLAG);
        // Only a reload should restore the subpage last shown — closing the UI
        // means starting on the tab's own page next time.
        sessionStorage.removeItem(PAGE_KEY);
      } catch {
        /* The page blocks sessionStorage */
      }
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

    // From the background (icon click).
    browser.runtime.onMessage.addListener((message) => {
      if ((message as ToggleMessage)?.type !== 'ink:toggle') return;
      log.debug('toggle empfangen, offen?', !!host);
      toggle();
    });

    // Trigger that does not need the SW (tests, possibly a shortcut later).
    window.addEventListener(TOGGLE_EVENT, () => {
      log.debug('toggle via window-event, offen?', !!host);
      toggle();
    });

    // Receiving end of feedback sharing: if an #ink-feedback=… payload hangs
    // in the hash, it is imported and the UI opens straight away with the
    // feedback panel.
    const shared = extractShareFromHash(location.hash);
    if (shared) {
      void decodeShare(shared)
        .then(async (items) => {
          const added = await addItems(items);
          log.info('geteiltes Feedback importiert', { total: items.length, neu: added });
          // Drop the hash, so a reload or a copied URL does not drag the payload along.
          history.replaceState(null, '', location.pathname + location.search);
          // Recipients should see the imported feedback immediately.
          open(true);
        })
        .catch((e: unknown) => log.error('shared feedback could not be read', e));
    } else {
      // If the UI was open in this tab, it survives F5/reload.
      let flag: string | null = null;
      try {
        flag = sessionStorage.getItem(OPEN_FLAG);
      } catch {
        /* The page blocks sessionStorage */
      }
      if (flag) {
        log.info('UI state restored (reload)');
        open(flag === 'feedback');
      }
    }

    log.debug('content script ready (dormant)');
  },
});
