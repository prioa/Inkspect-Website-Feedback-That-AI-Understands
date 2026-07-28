import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import type { BackgroundRequest } from '@/lib/messages';
import { framingBlockedByHeaders } from '@/lib/framing';
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
            // Nur die Domain, die betrachtet wird — fremde iframes *innerhalb*
            // der Vorschau (Werbung, OAuth, Payment) behalten ihre CSP.
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
   * Der Service Worker schlaeft nach kurzer Untaetigkeit ein, die
   * Session-Rules ueberleben ihn aber. Ohne diesen Abgleich waeren die Regeln
   * nach dem Aufwachen unbekannt — und wuerden nie wieder aufgeraeumt.
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
      if (rules.length > 0) log.info('Session-Rules uebernommen', rules.length);
    } catch (e) {
      log.warn('Session-Rules lesen fehlgeschlagen', e);
    }
  })();

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

    if (request?.type === 'ink:frame-check') {
      // Vorab-Request nur wegen der Header — der Body interessiert nicht und
      // wird sofort verworfen. Mit Cookies, weil manche Seiten die Header nur
      // fuer eingeloggte Nutzer setzen.
      const url = request.url;
      fetch(url, { method: 'GET', credentials: 'include', redirect: 'follow' })
        .then((res) => {
          void res.body?.cancel();
          const blocked = framingBlockedByHeaders(res.headers, new URL(url).origin);
          log.info('frame-check', { url, blocked });
          sendResponse({ ok: true, blocked });
        })
        .catch((e: unknown) => {
          // Im Zweifel laden lassen — die Erkennung nach dem Load faengt es ab.
          log.warn('frame-check fehlgeschlagen', url, e);
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
        });
      return true;
    }

    if (request?.type === 'ink:ui-state') {
      // Sichtbarer Aktiv-Zustand am Toolbar-Icon: Badge, solange die UI in
      // diesem Tab offen ist. Chrome raeumt Tab-Badges bei Navigation selbst
      // auf; das Content-Script meldet sich nach einem Reload ohnehin neu.
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
        sendResponse({ ok: false, error: 'Kein Tab-Kontext' });
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

  // Beim Verlassen der Seite stirbt das Content-Script und damit die UI — der
  // Eingriff darf sie nicht ueberleben. `status: 'loading'` deckt auch den
  // Reload derselben URL ab (dabei ist changeInfo.url nicht gesetzt); das
  // Neuladen der Preview-Frames loest kein tabs.onUpdated aus.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if ((changeInfo.url != null || changeInfo.status === 'loading') && bypassRules.has(tabId)) {
      log.info('Top-Level-Navigation — Bypass aufgeraeumt', tabId);
      void setBypass(tabId, false);
    }
  });
});
