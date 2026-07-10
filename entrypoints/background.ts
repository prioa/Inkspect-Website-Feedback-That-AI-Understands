import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import type { BackgroundRequest } from '@/lib/messages';
import { createLogger } from '@/lib/log';

export default defineBackground(() => {
  const log = createLogger('bg');
  log.info('service worker start', new Date().toISOString());

  /** tabId → id der aktiven Session-Rule. */
  const bypassRules = new Map<number, number>();
  let nextRuleId = 1;

  /**
   * Entfernt fuer Sub-Frames dieses einen Tabs die Header, die das Framen
   * verbieten. Session-Rule, weil nur die `tabIds` als Bedingung kennt.
   *
   * DNR kann Header nur komplett entfernen, nicht einzelne Direktiven — mit
   * der CSP fallen also auch die XSS-Schutzmassnahmen innerhalb der Frames.
   * Deshalb Opt-in, nur dieser Tab, nur sub_frame, Cleanup beim Schliessen.
   */
  async function setBypass(tabId: number, enabled: boolean): Promise<void> {
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
    log.info('setBypass', { tabId, enabled, ruleId: id });
    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds,
      addRules: [
        {
          id,
          priority: 1,
          condition: {
            tabIds: [tabId],
            resourceTypes: ['sub_frame'],
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

  /** Wartet, bis der Tab fertig geladen ist. */
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

    // Auf chrome://, about: und dem Add-on-Store laufen keine Content-Scripts.
    if (!tab.url || !/^https?:\/\//.test(tab.url)) {
      log.warn('action.onClicked: nicht injizierbare URL', tab.url);
      return;
    }

    try {
      await browser.tabs.sendMessage(tabId, { type: 'ink:toggle' });
      log.debug('toggle an vorhandenes Content-Script gesendet');
    } catch {
      // Tab war vor Installation/Update offen — Content-Script fehlt noch.
      log.debug('kein Content-Script — reload + toggle', tabId);
      await browser.tabs.reload(tabId);
      await waitForComplete(tabId);
      await browser.tabs.sendMessage(tabId, { type: 'ink:toggle' });
    }
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const request = message as BackgroundRequest;
    log.debug('onMessage', request?.type, 'von Tab', sender.tab?.id);

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
          log.warn('fetch-css Fehler', request.url, e);
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

    if (request?.type === 'ink:frame-bypass') {
      const tabId = sender.tab?.id;
      if (tabId == null) {
        sendResponse({ ok: false, error: 'Kein Tab-Kontext' });
        return false;
      }
      setBypass(tabId, request.enabled)
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

  // Beim Verlassen der Seite stirbt das Content-Script und damit die UI.
  // changeInfo.url ist nur bei echter Top-Level-Navigation gesetzt, nicht wenn
  // wir die Preview-Frames neu laden.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url != null && bypassRules.has(tabId)) {
      void setBypass(tabId, false);
    }
  });
});
