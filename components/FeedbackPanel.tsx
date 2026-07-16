import { useEffect, useRef, useState } from 'react';
import type { DeviceInstance, DevicePreset } from '@/lib/devices';
import type { Shape } from '@/lib/annotations';
import { pinNumbers, TOOL_LABELS } from '@/lib/annotations';
import type { FeedbackItem } from '@/lib/feedbackStore';
import {
  IconCheck,
  IconClose,
  IconCopy,
  IconDots,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconLink,
  IconMessage,
  IconPen,
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
  /** Marker auf der Seite ein-/ausblenden (globaler Schalter im Panel-Kopf). */
  markersVisible: boolean;
  onToggleMarkers: () => void;
  /** Vom Device-Badge angestossen: Gruppe hervorheben und hinscrollen. */
  highlight: { deviceId: string; nonce: number } | null;
  onJump: (deviceId: string) => void;
  /** Klick auf einen Eintrag: zum Marker scrollen und ihn aufblitzen lassen. */
  onJumpItem: (item: FeedbackItem) => void;
  /** Hover ueber einen Eintrag: Markierung im Viewport hervorheben. */
  onPreviewItem: (item: FeedbackItem | null) => void;
  /** Notiz/Text eines Eintrags aendern oder ergaenzen. */
  onEditItem: (itemId: string, text: string) => void;
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
  onExportScreenshots: (onProgress?: (done: number, total: number) => void) => Promise<number>;
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

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
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
  markersVisible,
  onToggleMarkers,
  highlight,
  onJump,
  onJumpItem,
  onPreviewItem,
  onEditItem,
  onNavigate,
  onDelete,
  onToggleDone,
  onClearAll,
  onBuildShareLink,
  onExportScreenshots,
  onClose,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  /** Bereich mit Feedback fremder Domains ein-/ausklappen. */
  const [showOther, setShowOther] = useState(false);

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

  const exportShots = () => {
    if (shotsPending) return;
    setShareUrl(null);
    setShareError(false);
    setShotsCount(null);
    setShotsPending(true);
    onExportScreenshots((done, total) => setShotsProgress({ done, total }))
      .then(setShotsCount)
      .catch(() => setShotsCount(0))
      .finally(() => {
        setShotsPending(false);
        setShotsProgress(null);
      });
  };

  // Nach Seite gruppiert, innerhalb nach Device-Preset. Bewusst stabil
  // alphabetisch statt "aktuelle Seite zuerst" — die Reihenfolge darf beim
  // Seitenwechsel nicht springen; die aktuelle Seite markiert das Badge.
  const byUrl = new Map<string, FeedbackItem[]>();
  for (const item of items) {
    const list = byUrl.get(item.url);
    if (list) list.push(item);
    else byUrl.set(item.url, [item]);
  }
  const pages = [...byUrl.entries()].sort(([a], [b]) => a.localeCompare(b));

  const pageCount = byUrl.get(url)?.length ?? 0;
  const openCount = items.filter((item) => !item.done).length;

  return (
    <aside className="panel panel--right" aria-label="Feedback">
      <div className="panel__head">
        <span className="panel__title">Feedback</span>
        {openCount > 0 && <span className="panel__count">{openCount}</span>}
        <span className="panel__spacer" />
        <button
          className={`icon-btn icon-btn--small${markersVisible ? '' : ' icon-btn--active'}`}
          title={markersVisible ? 'Hide all markings on the page' : 'Show markings'}
          aria-pressed={!markersVisible}
          onClick={onToggleMarkers}
        >
          {markersVisible ? <IconEye size={14} /> : <IconEyeOff size={14} />}
        </button>

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

      <div className="panel__url" title={url}>
        {pathOf(url)}
      </div>

      {items.length === 0 && (
        <div className="panel__empty">
          <IconMessage size={28} />
          <p>
            No feedback yet.
            <br />
            Right-click a preview to open the tool palette, then mark elements, drop pins or draw on
            a device.
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
          // `items` bleibt vollstaendig (Pin-Nummern muessen zu den Frames
          // passen), `visible` ist die ggf. um Erledigtes reduzierte Anzeige.
          const groups = [...presets, ...unknown]
            .map((preset) => {
              const groupItems = pageItems.filter((item) => item.deviceId === preset.id);
              return {
                preset,
                items: groupItems,
                visible: hideDone ? groupItems.filter((item) => !item.done) : groupItems,
              };
            })
            .filter((g) => g.visible.length > 0);
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
                const numbers = pinNumbers(groupItems.map((i) => i.shape));
                return (
                  <section
                    key={preset.id}
                    className={`fb-group${isCurrent && flashDevice === preset.id ? ' fb-group--flash' : ''}`}
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
                        return (
                          <li
                            key={item.id}
                            className={`fb-item${item.done ? ' fb-item--done' : ''}${editing ? ' fb-item--editing' : ''}`}
                            title={
                              isCurrent
                                ? `${shapeLabel(item.shape)} — click to jump to the marker`
                                : `${shapeLabel(item.shape)} — click to open the page and jump to the marker`
                            }
                            onClick={() => {
                              if (!editing) onJumpItem(item);
                            }}
                            onMouseEnter={() => onPreviewItem(item)}
                            onMouseLeave={() => onPreviewItem(null)}
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
                                  {meta && <span className="fb-item__meta">{meta}</span>}
                                </>
                              )}
                            </div>
                            <div className="fb-item__actions">
                              {textOf(item.shape) != null && !editing && (
                                <button
                                  className="icon-btn icon-btn--small"
                                  title="Edit note"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEdit(item);
                                  }}
                                >
                                  <IconPen size={12} />
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
            const domains = [...byDomain.entries()].sort(([a], [b]) => a.localeCompare(b));
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
                            className={`fb-item fb-item--static${item.done ? ' fb-item--done' : ''}`}
                            title={`${shapeLabel(item.shape)} — on ${pathOf(item.url)}`}
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
          <div className="share-row">
            <button className="share-btn" onClick={createShareLink} disabled={pageCount === 0}>
              <IconLink size={14} />
              Share as link
            </button>
            <button
              className="share-btn share-btn--alt"
              onClick={exportShots}
              disabled={shotsPending}
              title="Download annotated screenshots of every page with feedback (notes included)"
            >
              <IconDownload size={14} />
              {shotsPending
                ? shotsProgress && shotsProgress.total > 0
                  ? `Capturing ${Math.min(shotsProgress.done + 1, shotsProgress.total)}/${shotsProgress.total}…`
                  : 'Capturing…'
                : 'Screenshots'}
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

          {shotsCount !== null && (
            <div className={`share-hint${shotsCount === 0 ? ' share-hint--error' : ''}`}>
              {shotsCount === 0
                ? 'No screenshots could be captured.'
                : `${shotsCount} annotated screenshot${shotsCount === 1 ? '' : 's'} saved to your Downloads folder — markings and notes included.`}
            </div>
          )}

          {shareError && (
            <div className="share-hint share-hint--error">The link could not be created.</div>
          )}
        </div>
      )}
    </aside>
  );
}
