import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import type { BackgroundRequest } from '@/lib/messages';
import { framingBlockedByHeaders } from '@/lib/framing';
import { createLogger } from '@/lib/log';

export default defineBackground(() => {
  const log = createLogger('bg');
  log.info('service worker start', new Date().toISOString());

  // GitHub Pages URLs do not follow repository renames — after a rename this
  // URL has to be updated by hand. The page must be deployed before a version
  // carrying this constant goes to the store.
  const WELCOME_URL =
    'https://prioa.github.io/Inkspect-Website-Feedback-That-AI-Understands/welcome.html';

  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason !== 'install') return;
    // wxt dev reinstalls the extension on every start — no tab spam.
    if (import.meta.env.DEV) return;
    void browser.tabs.create({ url: WELCOME_URL }).catch(() => undefined);
  });

  /** tabId → id of the active session rule. */
  const bypassRules = new Map<number, number>();
  let nextRuleId = 1;

  /**
   * Removes the headers that forbid framing, for sub-frames of this one tab.
   * A session rule, because only those take `tabIds` as a condition.
   *
   * DNR can only remove headers wholesale, not individual directives — so the
   * XSS protections inside the frames fall along with the CSP. Hence opt-in,
   * this tab only, sub_frame only, cleaned up on close.
   */
  async function setBypass(tabId: number, enabled: boolean, host?: string): Promise<void> {
    const existing = bypassRules.get(tabId);
    const removeRuleIds = existing == null ? [] : [existing];

    if (!enabled) {
      if (removeRuleIds.length > 0) {
        await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds });
      }
      bypassRules.delete(tabId);
      return;
    }

    const id = existing ?? nextRuleId++;
    log.info('setBypass', { tabId, enabled, ruleId: id, host });
    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds,
      addRules: [
        {
          id,
          priority: 1,
          condition: {
            tabIds: [tabId],
            resourceTypes: ['sub_frame'],
            // Only the domain being looked at — foreign iframes *inside* the
            // preview (ads, OAuth, payment) keep their CSP.
            ...(host ? { requestDomains: [host] } : {}),
          },
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'x-frame-options', operation: 'remove' },
              { header: 'content-security-policy', operation: 'remove' },
              { header: 'content-security-policy-report-only', operation: 'remove' },
            ],
          },
        },
      ],
    } as Parameters<typeof browser.declarativeNetRequest.updateSessionRules>[0]);

    bypassRules.set(tabId, id);
  }

  /**
   * The service worker goes to sleep after a short idle, but the session rules
   * outlive it. Without this reconciliation the rules would be unknown after
   * waking up — and would never be cleaned up again.
   */
  const restored = (async () => {
    try {
      const rules = await browser.declarativeNetRequest.getSessionRules();
      for (const rule of rules) {
        const tabId = rule.condition?.tabIds?.[0];
        if (tabId == null) continue;
        bypassRules.set(tabId, rule.id);
        nextRuleId = Math.max(nextRuleId, rule.id + 1);
      }
      if (rules.length > 0) log.info('Session rules taken over', rules.length);
    } catch (e) {
      log.warn('Reading the session rules failed', e);
    }
  })();

  /** Waits until the tab has finished loading. */
  function waitForComplete(tabId: number): Promise<void> {
    return new Promise((resolve) => {
      const listener = (id: number, info: { status?: string }) => {
        if (id === tabId && info.status === 'complete') {
          browser.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      browser.tabs.onUpdated.addListener(listener);
    });
  }

  browser.action.onClicked.addListener(async (tab) => {
    const tabId = tab.id;
    log.info('action.onClicked', { tabId, url: tab.url });
    if (tabId == null) return;

    // No content scripts run on chrome://, about: or the add-on store. Rather
    // than a silent no-op (fatal right after installation, where the active tab
    // is usually the store or a new tab), the click opens the welcome page —
    // where Inkspect does work.
    if (!tab.url || !/^https?:\/\//.test(tab.url)) {
      log.warn('action.onClicked: URL cannot be injected — welcome page', tab.url);
      void browser.tabs.create({ url: WELCOME_URL }).catch(() => undefined);
      return;
    }

    try {
      await browser.tabs.sendMessage(tabId, { type: 'ink:toggle' });
      log.debug('toggle sent to the existing content script');
    } catch {
      // Tab was open before install/update — the content script is not there yet.
      log.debug('no content script — reload + toggle', tabId);
      await browser.tabs.reload(tabId);
      await waitForComplete(tabId);
      try {
        await browser.tabs.sendMessage(tabId, { type: 'ink:toggle' });
      } catch {
        // An https page where no script runs anyway (the Web Store, origins
        // blocked by policy) — do not run into nothing here either.
        log.warn('Content script still unreachable after the reload', tabId);
        void browser.tabs.create({ url: WELCOME_URL }).catch(() => undefined);
      }
    }
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const request = message as BackgroundRequest;
    log.debug('onMessage', request?.type, 'from tab', sender.tab?.id);

    if (request?.type === 'ink:fetch-css') {
      fetch(request.url)
        .then(async (res) => {
          if (!res.ok) {
            log.warn('fetch-css HTTP', res.status, request.url);
            return sendResponse({ ok: false, error: `HTTP ${res.status}` });
          }
          const text = await res.text();
          log.debug('fetch-css OK', request.url, `${text.length} bytes`);
          sendResponse({ ok: true, text });
        })
        .catch((e: unknown) => {
          log.warn('fetch-css error', request.url, e);
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
        });
      return true; // Antwort kommt asynchron.
    }

    if (request?.type === 'ink:capture') {
      const windowId = sender.tab?.windowId;
      browser.tabs
        .captureVisibleTab(windowId as number, { format: 'png' })
        .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
        .catch((e: unknown) => {
          log.warn('captureVisibleTab fehlgeschlagen', e);
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
        });
      return true;
    }

    if (request?.type === 'ink:frame-check') {
      // A pre-flight request purely for the headers — the body is of no
      // interest and is discarded immediately. With cookies, because some sites
      // only set the headers for signed-in users.
      const url = request.url;
      fetch(url, { method: 'GET', credentials: 'include', redirect: 'follow' })
        .then((res) => {
          void res.body?.cancel();
          const blocked = framingBlockedByHeaders(res.headers, new URL(url).origin);
          log.info('frame-check', { url, blocked });
          sendResponse({ ok: true, blocked });
        })
        .catch((e: unknown) => {
          // When in doubt, let it load — detection after the load catches it.
          log.warn('frame-check fehlgeschlagen', url, e);
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
        });
      return true;
    }

    if (request?.type === 'ink:ui-state') {
      // Visible active state on the toolbar icon: a badge for as long as the UI
      // is open in this tab. Chrome clears tab badges on navigation itself, and
      // the content script reports in again after a reload anyway.
      const tabId = sender.tab?.id;
      if (tabId != null) {
        void browser.action.setBadgeText({ tabId, text: request.open ? 'ON' : '' });
        if (request.open) {
          void browser.action.setBadgeBackgroundColor({ tabId, color: '#5b8cff' });
          void browser.action.setBadgeTextColor?.({ tabId, color: '#ffffff' });
        }
      }
      return false;
    }

    if (request?.type === 'ink:frame-bypass') {
      const tabId = sender.tab?.id;
      if (tabId == null) {
        sendResponse({ ok: false, error: 'No tab context' });
        return false;
      }
      restored
        .then(() => setBypass(tabId, request.enabled, request.host))
        .then(() => sendResponse({ ok: true }))
        .catch((e: unknown) => {
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
        });
      return true;
    }

    return false;
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void setBypass(tabId, false);
  });

  // Leaving the page kills the content script and with it the UI — the change
  // must not outlive it. `status: 'loading'` also covers a reload of the same
  // URL (where changeInfo.url is not set); reloading the preview frames does
  // not trigger tabs.onUpdated.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if ((changeInfo.url != null || changeInfo.status === 'loading') && bypassRules.has(tabId)) {
      log.info('Top-level navigation — bypass cleaned up', tabId);
      void setBypass(tabId, false);
    }
  });
});
