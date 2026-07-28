import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { DeviceInstance, DevicePreset } from '@/lib/devices';
import type { Shape } from '@/lib/annotations';
import { pinNumbers, shapeSize, TOOL_LABELS } from '@/lib/annotations';
import type { FeedbackItem } from '@/lib/feedbackStore';
import { feedbackToMarkdown } from '@/lib/exportMarkdown';
import { encodeShare, SHARE_PARAM } from '@/lib/share';
import {
  IconCheck,
  IconClose,
  IconCopy,
  IconDots,
  IconDownload,
  IconEditPen,
  IconEye,
  IconLayers,
  IconEyeOff,
  IconLink,
  IconPlus,
  IconTrash,
} from './icons';

interface Props {
  /** Gesamtes Feedback, seitenuebergreifend — das Panel gruppiert nach Seite. */
  items: FeedbackItem[];
  /** Feedback fremder Domains (gerade nicht geoeffnet) — eigener Bereich. */
  otherItems: FeedbackItem[];
  /** Aktuell geladene Seite (normalisiert). */
  url: string;
  /** Eingebaute + eigene Presets — bestimmt die Gruppierung. */
  presets: readonly DevicePreset[];
  devices: DeviceInstance[];
  /**
   * Preset-Ids der gerade sichtbaren Viewports (Grid-Devices bzw. im
   * Vollbild nur der Vollbild-Frame). Alles andere betrifft eine Seite oder
   * Groesse, die gerade nicht auf dem Schirm ist, und wird gedimmt.
   */
  activePresetIds: ReadonlySet<string>;
  /** Marker auf der Seite ein-/ausblenden (globaler Schalter im Panel-Kopf). */
  markersVisible: boolean;
  onToggleMarkers: () => void;
  /**
   * Zaehler: hochgezaehlt, nachdem eine frisch gezeichnete Markierung bei
   * ausgeblendeten Markern weggeblendet ist — der Schalter pulst dann kurz
   * und zeigt so, wo sie wieder auftaucht.
   */
  markersHint?: number;
  /** Vom Device-Badge angestossen: Gruppe hervorheben und hinscrollen. */
  highlight: { deviceId: string; nonce: number } | null;
  onJump: (deviceId: string) => void;
  /** Klick auf einen Eintrag: zum Marker scrollen und ihn aufblitzen lassen. */
  onJumpItem: (item: FeedbackItem) => void;
  /** Hover ueber einen Eintrag: Markierung im Viewport hervorheben. */
  onPreviewItem: (item: FeedbackItem | null) => void;
  /** Zeiger betritt/verlaesst das Panel — blendet im Dev-Modus die Marker ein. */
  onPanelHover?: (hovering: boolean) => void;
  /** Gespeicherte CSS-Aenderungen sind auf die Seite angewendet (Dev-Modus). */
  effectsApplied?: boolean;
  /** Anwenden der CSS-Aenderungen umschalten — Vergleich mit dem Original. */
  onToggleEffects?: () => void;
  /** Notiz/Text eines Eintrags aendern oder ergaenzen. */
  onEditItem: (itemId: string, text: string) => void;
  /** Element-Marker: Bearbeiten-Popup am Device wieder oeffnen (Werte + Notiz). */
  onEditElement?: (item: FeedbackItem) => void;
  /** Wechselt die Previews auf eine andere Seite (Feedback-Herkunft). */
  onNavigate: (url: string) => void;
  onDelete: (itemId: string) => void;
  /** Erledigt-Status eines Eintrags umschalten. */
  onToggleDone: (itemId: string) => void;
  onClearAll: () => void;
  /** Baut die Share-URL (Feedback deflate+base64url im Hash). */
  onBuildShareLink: () => Promise<string>;
  /**
   * Laedt annotierte Full-Page-Screenshots aller Seiten mit offenem Feedback
   * herunter (inkl. Notizen an den Markern); liefert die Anzahl der Bilder.
   * `onProgress` meldet erledigte/gesamte Captures fuer die Anzeige.
   */
  onExportScreenshots: (
    onProgress?: (done: number, total: number) => void,
    /** Zusaetzlich zu fotografierende Seiten (ohne die aktuelle). */
    extraPages?: string[],
  ) => Promise<number>;
  /** Oeffnet das Shortcuts-/Hilfe-Overlay (aus dem leeren Zustand heraus). */
  onShowShortcuts: () => void;
  /** Panel-Breite (ziehbar) in Shell-Pixeln. */
  width: number;
  /**
   * Vollbild: Position der schwebenden Karte, wenn der Feedback-Knopf
   * verschoben wurde. Ohne das bleibt die feste Ecke aus `styles.ts`.
   */
  anchor?: CSSProperties;
  onClose: () => void;
}

/** Anzeigetext eines Eintrags: Notiz/Text wenn vorhanden, sonst Element/Werkzeug-Label. */
function shapeLabel(shape: Shape): string {
  if (shape.tool === 'pin' || shape.tool === 'text') return shape.text || TOOL_LABELS[shape.tool];
  if (shape.tool === 'element') return shape.note ? `${shape.label} — ${shape.note}` : shape.label;
  if (shape.note) return `${TOOL_LABELS[shape.tool]} — ${shape.note}`;
  return TOOL_LABELS[shape.tool];
}

/** Editierbarer Freitext eines Eintrags. */
function textOf(shape: Shape): string | null {
  if (shape.tool === 'pin' || shape.tool === 'text') return shape.text;
  return shape.note ?? '';
}

/** Hauptzeile: Freitext, sonst Element-Selektor bzw. Werkzeugname. */
function primaryOf(shape: Shape): { text: string; empty: boolean } {
  const value = textOf(shape);
  if (value) return { text: value, empty: false };
  if (shape.tool === 'element') return { text: shape.label, empty: false };
  return { text: 'Add note…', empty: true };
}

/** Kontextzeile unter der Hauptzeile: Werkzeug, beim Element der Selektor. */
function metaOf(shape: Shape): string | null {
  if (shape.tool === 'element') return shape.note ? shape.label : TOOL_LABELS.element;
  return TOOL_LABELS[shape.tool];
}

/**
 * Pfad samt Query-Parametern, fuer die Anzeige lesbar gemacht: aus
 * `%C3%BC` wird wieder `ü`. Schlaegt das Dekodieren fehl (kaputte
 * Prozent-Sequenz), bleibt die rohe Form stehen.
 */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const raw = u.pathname + u.search;
    try {
      return decodeURI(raw);
    } catch {
      return raw;
    }
  } catch {
    return url;
  }
}

/** Anzeige-Reihenfolge der Liste: das Neueste zuerst. */
function newestFirst(a: FeedbackItem, b: FeedbackItem): number {
  return b.createdAt - a.createdAt;
}

/** Zeitstempel des juengsten Eintrags einer Gruppe (0 wenn leer). */
function newestOf(list: readonly FeedbackItem[]): number {
  let newest = 0;
  for (const item of list) if (item.createdAt > newest) newest = item.createdAt;
  return newest;
}

/** „vor 3 Tagen" statt eines Datums — die Reihenfolge soll sofort sitzen. */
function ago(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function FeedbackPanel({
  items,
  otherItems,
  url,
  presets,
  devices,
  activePresetIds,
  markersVisible,
  onToggleMarkers,
  markersHint = 0,
  highlight,
  onJump,
  onJumpItem,
  onPreviewItem,
  onPanelHover,
  effectsApplied = true,
  onToggleEffects,
  onEditItem,
  onEditElement,
  onNavigate,
  onDelete,
  onToggleDone,
  onClearAll,
  onBuildShareLink,
  onExportScreenshots,
  onShowShortcuts,
  width,
  anchor,
  onClose,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [mdCopied, setMdCopied] = useState(false);
  /** Bereich mit Feedback fremder Domains ein-/ausklappen. */
  const [showOther, setShowOther] = useState(false);

  // Hover haengt bewusst an React-State statt an CSS :hover — Chrome laesst
  // :hover stehen, wenn der Eintrag unter dem Zeiger verschwindet/verrutscht
  // oder der Zeiger in den Device-iframe wechselt; die Aktionsknoepfe blieben
  // dann sichtbar. Der Effekt unten raeumt solche Faelle nach.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hoverElRef = useRef<HTMLElement | null>(null);
  const enterItem = (el: HTMLElement, item: FeedbackItem, preview: boolean) => {
    hoverElRef.current = el;
    setHoverId(item.id);
    if (preview) onPreviewItem(item);
  };
  const leaveItem = (item: FeedbackItem, preview: boolean) => {
    hoverElRef.current = null;
    setHoverId((id) => (id === item.id ? null : id));
    if (preview) onPreviewItem(null);
  };

  useEffect(() => {
    if (!hoverId) return;
    const clear = () => {
      hoverElRef.current = null;
      setHoverId(null);
      onPreviewItem(null);
    };
    // Jede Zeigerbewegung ausserhalb des gemerkten Eintrags beendet den
    // Hover — auch wenn dessen mouseleave nie ankam.
    //
    // Geprueft wird ueber `composedPath()`, nicht ueber `e.target`: der
    // Listener haengt am Dokument, das Panel lebt aber im Shadow Root. Dort
    // entstandene Events werden auf den Host *retargetiert* — `e.target` waere
    // also nie der gehoverte Eintrag, und schon die erste Zeigerbewegung
    // raeumte den Hover ab. Die Aktionsknoepfe verschwanden dadurch, bevor man
    // sie erreichen konnte. Der Composed Path enthaelt die echten Elemente.
    const check = (e: Event) => {
      const el = hoverElRef.current;
      if (!el || !e.composedPath().includes(el)) clear();
    };
    document.addEventListener('pointerover', check, true);
    document.addEventListener('pointermove', check, true);
    // Zeiger verlaesst das Fenster bzw. Fokus wandert in den iframe.
    document.addEventListener('mouseleave', clear);
    window.addEventListener('blur', clear);
    return () => {
      document.removeEventListener('pointerover', check, true);
      document.removeEventListener('pointermove', check, true);
      document.removeEventListener('mouseleave', clear);
      window.removeEventListener('blur', clear);
    };
    // onPreviewItem ist eine stabile Callback-Prop des Panels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverId]);

  // Inline-Editor fuer Notiz/Text eines Eintrags.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const startEdit = (item: FeedbackItem) => {
    setEditingId(item.id);
    setEditDraft(textOf(item.shape) ?? '');
  };
  const commitEdit = (item: FeedbackItem) => {
    // Escape hat den Editor bereits geschlossen — das folgende blur darf
    // dann nicht doch noch speichern.
    if (editingId !== item.id) return;
    setEditingId(null);
    const before = (textOf(item.shape) ?? '').trim();
    if (editDraft.trim() !== before) onEditItem(item.id, editDraft);
  };

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  /**
   * Seitenauswahl vor dem Export. Sie faehrt aus dem Screenshot-Knopf heraus,
   * und derselbe Knopf loest danach aus — so muss die Maus nicht zwischen
   * Liste und Bestaetigen hin und her.
   */
  const [pickOpen, setPickOpen] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  // Klick ausserhalb schliesst die Seitenauswahl. Geprueft ueber den
  // Composed Path: das Panel lebt im Shadow Root, `e.target` waere am
  // Dokument auf den Host retargetiert.
  const pickRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!pickOpen) return;
    const close = (e: Event) => {
      const el = pickRef.current;
      if (el && !e.composedPath().includes(el)) setPickOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [pickOpen]);

  const [shotsPending, setShotsPending] = useState(false);
  const [shotsCount, setShotsCount] = useState<number | null>(null);
  const [shotsProgress, setShotsProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // Beim Seitenwechsel innerhalb der (stabilen) Liste zur aktuellen Seite
  // scrollen — die Reihenfolge selbst bleibt unveraendert.
  const currentPageRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    currentPageRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }, [url]);

  // Device-Badge geklickt: betroffene Gruppe hinscrollen und kurz aufflashen.
  const [flashDevice, setFlashDevice] = useState<string | null>(null);
  const groupRefs = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (!highlight) return;
    setFlashDevice(highlight.deviceId);
    groupRefs.current
      .get(highlight.deviceId)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const timer = window.setTimeout(() => setFlashDevice(null), 1600);
    return () => clearTimeout(timer);
  }, [highlight]);

  useEffect(() => {
    if (!shareCopied) return;
    const timer = window.setTimeout(() => setShareCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [shareCopied]);

  useEffect(() => {
    if (!mdCopied) return;
    const timer = window.setTimeout(() => setMdCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [mdCopied]);

  // Gesamtes Domain-Feedback als Markdown-Checkliste in die Zwischenablage —
  // zum Weiterreichen in ein Ticket-/Doku-Tool.
  const copyMarkdown = () => {
    if (items.length === 0) return;
    // Der Payload haengt hinten dran, damit sich der Stand aus dem Text
    // heraus wiederherstellen laesst — scheitert das Codieren, geht die
    // Liste trotzdem raus.
    void encodeShare(items)
      .catch(() => undefined)
      .then((payload) => {
        const md = feedbackToMarkdown(
          items,
          presets,
          payload && `#${SHARE_PARAM}=${payload}`,
        );
        if (!md) return;
        return navigator.clipboard.writeText(md).then(() => setMdCopied(true));
      })
      .catch(() => {
        /* Clipboard verweigert — kein Fallback, Screenshot/Link bleiben */
      });
  };

  // Der Link codiert den Feedback-Stand — bei Aenderungen veraltet er.
  useEffect(() => {
    setShareUrl(null);
    setShareError(false);
    setShotsCount(null);
  }, [items]);

  // Link bauen UND direkt in die Zwischenablage legen — die Box darunter
  // bleibt als Fallback zum manuellen Kopieren sichtbar.
  const createShareLink = () => {
    setShareError(false);
    setShotsCount(null);
    onBuildShareLink()
      .then(async (link) => {
        setShareUrl(link);
        try {
          await navigator.clipboard.writeText(link);
          setShareCopied(true);
        } catch {
          /* Clipboard verweigert — Box mit Copy-Button bleibt als Fallback */
        }
      })
      .catch(() => setShareError(true));
  };

  const copyShareLink = () => {
    if (!shareUrl) return;
    void navigator.clipboard.writeText(shareUrl).then(() => setShareCopied(true));
  };

  /**
   * Andere Seiten derselben Domain mit offenem Feedback — zuletzt bearbeitete
   * zuerst. Nur wenn es welche gibt, ist ueberhaupt etwas zu waehlen.
   */
  const otherPages = (() => {
    const map = new Map<string, { count: number; updatedAt: number }>();
    for (const item of items) {
      if (item.url === url || item.done) continue;
      const seen = map.get(item.url);
      if (seen) {
        seen.count += 1;
        seen.updatedAt = Math.max(seen.updatedAt, item.createdAt);
      } else {
        map.set(item.url, { count: 1, updatedAt: item.createdAt });
      }
    }
    return [...map.entries()]
      .map(([pageUrl, v]) => ({ url: pageUrl, ...v }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  })();

  const runShots = (extra: string[]) => {
    setPickOpen(false);
    setShareUrl(null);
    setShareError(false);
    setShotsCount(null);
    setShotsPending(true);
    onExportScreenshots((done, total) => setShotsProgress({ done, total }), extra)
      .then(setShotsCount)
      .catch(() => setShotsCount(0))
      .finally(() => {
        setShotsPending(false);
        setShotsProgress(null);
      });
  };

  const exportShots = () => {
    if (shotsPending) return;
    // Ohne andere Seiten gibt es nichts zu waehlen — direkt los.
    if (otherPages.length === 0) return runShots([]);
    // Erster Klick oeffnet die Liste, der zweite loest aus.
    if (!pickOpen) {
      setPicked(new Set());
      setPickOpen(true);
      return;
    }
    runShots([...picked]);
  };

  // Nach Seite gruppiert, innerhalb nach Device-Preset. Die Seite mit dem
  // juengsten Eintrag steht oben — das frisch Markierte soll man nicht suchen
  // muessen. Bewusst *nicht* "aktuelle Seite zuerst": die Reihenfolge darf
  // beim blossen Seitenwechsel nicht springen (die aktuelle Seite markiert
  // das Badge), und ohne neues Feedback aendert sich hier nichts.
  const byUrl = new Map<string, FeedbackItem[]>();
  for (const item of items) {
    const list = byUrl.get(item.url);
    if (list) list.push(item);
    else byUrl.set(item.url, [item]);
  }
  const pages = [...byUrl.entries()].sort(
    ([urlA, a], [urlB, b]) => newestOf(b) - newestOf(a) || urlA.localeCompare(urlB),
  );

  const pageCount = byUrl.get(url)?.length ?? 0;
  const openCount = items.filter((item) => !item.done).length;

  return (
    <aside
      className="panel panel--right"
      aria-label="Feedback"
      style={{ width, ...anchor }}
      onMouseEnter={() => onPanelHover?.(true)}
      onMouseLeave={() => onPanelHover?.(false)}
    >
      <div className="panel__head">
        <span className="panel__title">Feedback</span>
        {openCount > 0 && <span className="panel__count">{openCount}</span>}
        <span className="panel__spacer" />

        <span className="panel__menu">
          <button
            className={`icon-btn icon-btn--small${menuOpen ? ' icon-btn--active' : ''}`}
            title="Manage"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <IconDots size={14} />
          </button>
          {menuOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="menu" role="menu">
                <button
                  className="menu__item"
                  role="menuitem"
                  onClick={() => {
                    setHideDone((v) => !v);
                    setMenuOpen(false);
                  }}
                >
                  <span className="menu__item-icon">
                    <IconCheck size={15} />
                  </span>
                  <span className="menu__item-name">
                    {hideDone ? 'Show completed' : 'Hide completed'}
                  </span>
                </button>
                <button
                  className="menu__item menu__item--danger"
                  role="menuitem"
                  disabled={pageCount === 0}
                  onClick={() => {
                    onClearAll();
                    setMenuOpen(false);
                  }}
                >
                  <span className="menu__item-icon">
                    <IconTrash size={15} />
                  </span>
                  <span className="menu__item-name">Delete all (this page)</span>
                </button>
              </div>
            </>
          )}
        </span>

        <button className="icon-btn icon-btn--small" title="Close panel" onClick={onClose}>
          <IconClose size={14} />
        </button>
      </div>

      {/* Steuerleiste mit klaren Beschriftungen: die Wirkung der Aenderungen
          und die Sichtbarkeit der roten Markierungen getrennt schalten. */}
      <div className="panel__devbar">
        {onToggleEffects && (
          <button
            className={`devtoggle${effectsApplied ? ' is-on' : ''}`}
            aria-pressed={effectsApplied}
            title={
              effectsApplied
                ? 'The saved changes are applied to the page — click to see the original'
                : 'Showing the original page — click to apply the saved changes'
            }
            onClick={onToggleEffects}
          >
            <IconLayers size={13} />
            <span>Apply changes</span>
            <span className="devtoggle__state">{effectsApplied ? 'On' : 'Off'}</span>
          </button>
        )}
        <button
          // Der Zaehler als key startet die Hinweis-Animation auch dann neu,
          // wenn sie noch laeuft.
          key={markersHint}
          className={`devtoggle${markersVisible ? ' is-on' : ''}${
            markersHint > 0 ? ' devtoggle--hint' : ''
          }`}
          aria-pressed={markersVisible}
          title={
            markersVisible
              ? 'Red markings always visible — click to hide them (hover the panel to peek)'
              : 'Red markings hidden — hover the panel to peek, click to keep them on'
          }
          onClick={onToggleMarkers}
        >
          {markersVisible ? <IconEye size={13} /> : <IconEyeOff size={13} />}
          <span>Show markings</span>
          <span className="devtoggle__state">{markersVisible ? 'On' : 'Off'}</span>
        </button>
      </div>

      <div className="panel__url" title={url}>
        {pathOf(url)}
      </div>

      {items.length === 0 && (
        <div className="panel__empty">
          <div className="panel__empty-art" aria-hidden="true">
            <svg width="112" height="72" viewBox="0 0 112 72" fill="none">
              <rect
                x="1"
                y="1"
                width="70"
                height="70"
                rx="6"
                stroke="currentColor"
                strokeWidth="1.5"
                opacity="0.5"
              />
              <rect
                x="80"
                y="14"
                width="31"
                height="46"
                rx="5"
                stroke="currentColor"
                strokeWidth="1.5"
                opacity="0.5"
              />
              <circle cx="30" cy="30" r="9" fill="var(--accent)" />
              <path
                d="M30 26v8M26 30h8"
                stroke="#fff"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M44 52c4-9 7-12 10-9 3 3-3 9 1 9 3 0 6-9 12-13"
                stroke="var(--accent)"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p>
            <strong>No feedback yet.</strong>
            <br />
            Right-click a preview — or pick a tool from the bar below — to mark elements, drop
            pins or draw on a device.
          </p>
          <p className="panel__empty-tip">
            <button className="link-btn" onClick={onShowShortcuts}>
              Show shortcuts
            </button>
          </p>
        </div>
      )}

      <div className="panel__scroll">
        {pages.map(([pageUrl, pageItems]) => {
          const isCurrent = pageUrl === url;
          // Unbekannte deviceIds (geloeschtes Custom-Preset) bekommen eine
          // eigene Gruppe statt stillschweigend zu verschwinden.
          const known = new Set(presets.map((p) => p.id));
          const unknown = [...new Set(pageItems.map((i) => i.deviceId))]
            .filter((id) => !known.has(id))
            .map((id): DevicePreset => ({ id, name: id, width: 0, height: 0 }));
          // `items` bleibt vollstaendig *und* in Zeichen-Reihenfolge (die
          // Pin-Nummern muessen zu denen auf den Frames passen); `visible` ist
          // die Anzeige: ggf. um Erledigtes reduziert und neueste zuerst.
          const groups = [...presets, ...unknown]
            .map((preset) => {
              const groupItems = pageItems.filter((item) => item.deviceId === preset.id);
              return {
                preset,
                items: groupItems,
                visible: (hideDone ? groupItems.filter((item) => !item.done) : groupItems)
                  .slice()
                  .sort(newestFirst),
              };
            })
            .filter((g) => g.visible.length > 0)
            // Auch die Device-Gruppen richten sich nach ihrem juengsten
            // Eintrag — sonst landet das frisch Markierte mitten im Panel.
            .sort((a, b) => newestOf(b.visible) - newestOf(a.visible));
          if (groups.length === 0) return null;

          return (
            <div
              key={pageUrl}
              className={`fb-page${isCurrent ? '' : ' fb-page--other'}`}
              ref={isCurrent ? currentPageRef : undefined}
            >
              {(pages.length > 1 || !isCurrent) && (
                <button
                  className="fb-page__head"
                  title={isCurrent ? 'Current page' : 'Switch the previews to this page'}
                  disabled={isCurrent}
                  onClick={() => onNavigate(pageUrl)}
                >
                  <span className="fb-page__path">{pathOf(pageUrl)}</span>
                  {isCurrent && <span className="fb-page__badge">current</span>}
                </button>
              )}

              {groups.map(({ preset, items: groupItems, visible }) => {
                const inGrid = devices.some((d) => d.id === preset.id);
                // Andere Seite oder ein Viewport, der gerade nicht offen ist:
                // gedimmt, damit auf einen Blick klar ist, was zum aktuellen
                // Bild gehoert und was nicht.
                const offContext = !isCurrent || !activePresetIds.has(preset.id);
                const numbers = pinNumbers(groupItems.map((i) => i.shape));
                return (
                  <section
                    key={preset.id}
                    className={`fb-group${offContext ? ' fb-group--off' : ''}${
                      isCurrent && flashDevice === preset.id ? ' fb-group--flash' : ''
                    }`}
                    ref={(el) => {
                      if (!isCurrent) return;
                      if (el) groupRefs.current.set(preset.id, el);
                      else groupRefs.current.delete(preset.id);
                    }}
                  >
                    <button
                      className="fb-group__head"
                      title={
                        isCurrent
                          ? inGrid
                            ? 'Jump to device'
                            : 'Add device to the grid'
                          : 'Switch the previews to this page'
                      }
                      onClick={() => (isCurrent ? onJump(preset.id) : onNavigate(pageUrl))}
                    >
                      <span className="fb-group__name">{preset.name}</span>
                      {preset.width > 0 && (
                        <span className="fb-group__size">
                          {preset.width}×{preset.height}
                        </span>
                      )}
                      {isCurrent && !inGrid && (
                        <span className="fb-group__add">
                          <IconPlus size={12} />
                        </span>
                      )}
                    </button>

                    <ul className="fb-list">
                      {visible.map((item) => {
                        const editing = editingId === item.id;
                        const primary = primaryOf(item.shape);
                        const meta = metaOf(item.shape);
                        const size = shapeSize(item.shape);
                        return (
                          <li
                            key={item.id}
                            className={`fb-item${item.done ? ' fb-item--done' : ''}${editing ? ' fb-item--editing' : ''}${hoverId === item.id ? ' fb-item--hover' : ''}`}
                            title={
                              editing
                                ? undefined
                                : isCurrent
                                  ? 'Double-click to edit · single click jumps to the marker'
                                  : 'Double-click to edit · single click opens the page and jumps'
                            }
                            onDoubleClick={() => {
                              if (editing) return;
                              // Wie der Stift-Knopf: Element-Marker oeffnen ihr
                              // Popup, alle anderen den Inline-Notiz-Editor.
                              if (item.shape.tool === 'element' && onEditElement) {
                                onEditElement(item);
                              } else {
                                startEdit(item);
                              }
                            }}
                            onClick={() => {
                              if (!editing) onJumpItem(item);
                            }}
                            onMouseEnter={(e) => enterItem(e.currentTarget, item, true)}
                            onMouseLeave={() => leaveItem(item, true)}
                          >
                            <button
                              className={`fb-check${item.done ? ' fb-check--done' : ''}`}
                              title={item.done ? 'Mark as open' : 'Mark as done'}
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleDone(item.id);
                              }}
                            >
                              {item.done && <IconCheck size={10} />}
                            </button>
                            {item.shape.tool === 'pin' ? (
                              <span
                                className="fb-item__pin"
                                style={{ background: item.shape.color }}
                              >
                                {numbers.get(item.shape.id)}
                              </span>
                            ) : (
                              <span
                                className="fb-item__dot"
                                style={{ background: item.shape.color }}
                              />
                            )}
                            <div className="fb-item__body">
                              {editing ? (
                                <textarea
                                  className="fb-item__edit"
                                  value={editDraft}
                                  autoFocus
                                  rows={2}
                                  spellCheck={false}
                                  placeholder="Add a note…"
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => setEditDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault();
                                      commitEdit(item);
                                    }
                                    if (e.key === 'Escape') setEditingId(null);
                                  }}
                                  onBlur={() => commitEdit(item)}
                                />
                              ) : (
                                <>
                                  <span
                                    className={`fb-item__label${primary.empty ? ' fb-item__label--empty' : ''}`}
                                    onClick={
                                      primary.empty
                                        ? (e) => {
                                            e.stopPropagation();
                                            startEdit(item);
                                          }
                                        : undefined
                                    }
                                  >
                                    {primary.text}
                                  </span>
                                  <span className="fb-item__meta-row">
                                    {meta && <span className="fb-item__meta">{meta}</span>}
                                    {size && <span className="fb-item__size">{size}</span>}
                                  </span>
                                  {item.shape.tool === 'element' &&
                                    ((item.shape.styleChanges?.length ?? 0) > 0 ||
                                      item.shape.textChange) && (
                                      <span className="fb-item__changes">
                                        {item.shape.styleTarget && (
                                          <span className="fb-chg-target">
                                            {item.shape.styleTarget}
                                          </span>
                                        )}
                                        {item.shape.textChange && (
                                          <span className="fb-chg fb-chg--text">
                                            <span className="fb-chg-prop">text</span>
                                            <span className="fb-chg-from">
                                              {item.shape.textChange.from}
                                            </span>
                                            <span className="fb-chg-arr">→</span>
                                            <span className="fb-chg-to">
                                              {item.shape.textChange.to}
                                            </span>
                                          </span>
                                        )}
                                        {(item.shape.styleChanges ?? []).map((c) => (
                                          <span className="fb-chg" key={c.prop}>
                                            <span className="fb-chg-prop">{c.prop}</span>
                                            <span className="fb-chg-from">{c.from}</span>
                                            <span className="fb-chg-arr">→</span>
                                            <span className="fb-chg-to">{c.to}</span>
                                          </span>
                                        ))}
                                      </span>
                                    )}
                                </>
                              )}
                            </div>
                            <div className="fb-item__actions">
                              {textOf(item.shape) != null && !editing && (
                                <button
                                  className="icon-btn icon-btn--small"
                                  title={
                                    item.shape.tool === 'element' && onEditElement
                                      ? 'Edit marker (values + note)'
                                      : 'Edit note'
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Element-Marker: Popup am Device wieder
                                    // oeffnen — dort sind auch die Werte dran.
                                    if (item.shape.tool === 'element' && onEditElement) {
                                      onEditElement(item);
                                    } else {
                                      startEdit(item);
                                    }
                                  }}
                                >
                                  <IconEditPen size={12} />
                                </button>
                              )}
                              <button
                                className="icon-btn icon-btn--small icon-btn--danger"
                                title="Delete entry"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDelete(item.id);
                                }}
                              >
                                <IconClose size={12} />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          );
        })}

        {otherItems.length > 0 &&
          (() => {
            // Fremde Domains: nach Host, darin nach Seite gruppiert. Nur
            // Ansehen/Abhaken/Loeschen — zum Marker springen geht erst auf
            // der Domain selbst (Cross-Origin ist in den Previews gesperrt).
            const byDomain = new Map<string, FeedbackItem[]>();
            for (const item of otherItems) {
              const host = hostOf(item.url);
              const list = byDomain.get(host);
              if (list) list.push(item);
              else byDomain.set(host, [item]);
            }
            // Auch hier oben, was zuletzt entstanden ist — Hosts nach ihrem
            // juengsten Eintrag, die Eintraege selbst absteigend.
            const domains = [...byDomain.entries()]
              .map(([host, list]): [string, FeedbackItem[]] => [
                host,
                list.slice().sort(newestFirst),
              ])
              .sort(([, a], [, b]) => newestOf(b) - newestOf(a));
            const openOther = otherItems.filter((item) => !item.done).length;

            return (
              <div className="fb-other">
                <button
                  className="fb-other__head"
                  aria-expanded={showOther}
                  title="Feedback saved on other domains"
                  onClick={() => setShowOther((v) => !v)}
                >
                  <span className={`fb-other__chev${showOther ? ' fb-other__chev--open' : ''}`} />
                  <span className="fb-other__title">Other domains</span>
                  {openOther > 0 && <span className="panel__count">{openOther}</span>}
                </button>

                {showOther &&
                  domains.map(([host, domainItems]) => (
                    <div key={host} className="fb-page fb-page--other">
                      <div className="fb-page__head fb-other__domain" title={`Open ${host} and start Inkspect there to jump to these markers`}>
                        <span className="fb-page__path">{host}</span>
                        <span className="fb-page__badge">{domainItems.length}</span>
                      </div>
                      <ul className="fb-list">
                        {domainItems.map((item) => (
                          <li
                            key={item.id}
                            className={`fb-item fb-item--static${item.done ? ' fb-item--done' : ''}${hoverId === item.id ? ' fb-item--hover' : ''}`}
                            title={`${shapeLabel(item.shape)} — on ${pathOf(item.url)}`}
                            onMouseEnter={(e) => enterItem(e.currentTarget, item, false)}
                            onMouseLeave={() => leaveItem(item, false)}
                          >
                            <button
                              className={`fb-check${item.done ? ' fb-check--done' : ''}`}
                              title={item.done ? 'Mark as open' : 'Mark as done'}
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleDone(item.id);
                              }}
                            >
                              {item.done && <IconCheck size={10} />}
                            </button>
                            <span className="fb-item__dot" style={{ background: item.shape.color }} />
                            <div className="fb-item__body">
                              <span className="fb-item__label">{shapeLabel(item.shape)}</span>
                              <span className="fb-item__meta">{pathOf(item.url)}</span>
                            </div>
                            <div className="fb-item__actions">
                              <button
                                className="icon-btn icon-btn--small icon-btn--danger"
                                title="Delete entry"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDelete(item.id);
                                }}
                              >
                                <IconClose size={12} />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            );
          })()}
      </div>

      {items.length > 0 && (
        <div className="panel__share">
          {/* Teilen steht allein in der ersten Zeile — es ist die Hauptaktion;
              Screenshot und Markdown teilen sich die Zeile darunter. */}
          <div className="share-row">
            <button className="share-btn" onClick={createShareLink} disabled={pageCount === 0}>
              <IconLink size={14} />
              Share as link
            </button>
          </div>
          {/* Die Auswahl haengt an der *Zeile*, nicht am Knopf: sonst erbt sie
              dessen halbe Breite und die Pfade waeren abgeschnitten. */}
          <div className="share-row share-row--pick" ref={pickRef}>
            {pickOpen && (
              <div className="shotpick" role="group" aria-label="Pages to capture">
                <div className="shotpick__head">
                  Also capture…
                  <button
                    type="button"
                    className="icon-btn icon-btn--small"
                    aria-label="Close"
                    onClick={() => setPickOpen(false)}
                  >
                    <IconClose size={13} />
                  </button>
                </div>
                <div className="shotpick__list">
                  <label className="shotpick__row shotpick__row--fixed">
                    <span className="shotpick__box is-on">
                      <IconCheck size={11} />
                    </span>
                    <span className="shotpick__path">{pathOf(url) || '/'}</span>
                    <span className="shotpick__tag">this page</span>
                  </label>
                  {otherPages.map((page) => (
                    <label key={page.url} className="shotpick__row">
                      <span className={`shotpick__box${picked.has(page.url) ? ' is-on' : ''}`}>
                        {picked.has(page.url) && <IconCheck size={11} />}
                      </span>
                      <input
                        type="checkbox"
                        className="shotpick__input"
                        checked={picked.has(page.url)}
                        onChange={() =>
                          setPicked((set) => {
                            const next = new Set(set);
                            if (!next.delete(page.url)) next.add(page.url);
                            return next;
                          })
                        }
                      />
                      <span className="shotpick__path" title={page.url}>
                        {pathOf(page.url) || '/'}
                      </span>
                      <span className="shotpick__meta">
                        {page.count} · {ago(page.updatedAt)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <button
              className={`share-btn share-btn--alt${pickOpen ? ' share-btn--armed' : ''}`}
              onClick={exportShots}
              disabled={shotsPending}
              title={
                pickOpen
                  ? 'Capture the selected pages'
                  : 'Download annotated PDFs of this page (notes and changes included)'
              }
            >
              <IconDownload size={14} />
              {shotsPending
                ? shotsProgress && shotsProgress.total > 0
                  ? `Capturing ${Math.min(shotsProgress.done + 1, shotsProgress.total)}/${shotsProgress.total}…`
                  : 'Capturing…'
                : pickOpen
                  ? `Screenshot${picked.size > 0 ? ` (${picked.size + 1})` : ''}`
                  : 'Screenshots'}
            </button>
            <button
              className="share-btn share-btn--alt"
              onClick={copyMarkdown}
              disabled={items.length === 0}
              title="Copy all feedback of this domain as a Markdown checklist"
            >
              <IconCopy size={14} />
              Markdown
            </button>
          </div>

          {shareUrl !== null && (
            <>
              <div className="share-box">
                <input
                  className="share-box__url"
                  readOnly
                  value={shareUrl}
                  spellCheck={false}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  className="icon-btn icon-btn--small"
                  title={shareCopied ? 'Copied!' : 'Copy link'}
                  onClick={copyShareLink}
                >
                  {shareCopied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                </button>
              </div>
              <div className={`share-hint${shareCopied ? ' share-hint--ok' : ''}`}>
                {shareCopied
                  ? 'Link copied to your clipboard.'
                  : 'All markings of this page are encoded in the link. Anyone opening it with the Inkspect extension sees them directly on the page.'}
              </div>
            </>
          )}

          {/* Negativ heisst: abgebrochen (Seitenauswahl weggeklickt) — dazu
              gibt es nichts zu melden. */}
          {shotsCount !== null && shotsCount >= 0 && (
            <div className={`share-hint${shotsCount === 0 ? ' share-hint--error' : ''}`}>
              {shotsCount === 0
                ? 'No screenshots could be captured.'
                : `${shotsCount} annotated PDF${shotsCount === 1 ? '' : 's'} saved to your Downloads folder — markings and notes included.`}
            </div>
          )}

          {shareError && (
            <div className="share-hint share-hint--error">The link could not be created.</div>
          )}

          {mdCopied && (
            <div className="share-hint share-hint--ok">
              Feedback copied as a Markdown checklist.
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
