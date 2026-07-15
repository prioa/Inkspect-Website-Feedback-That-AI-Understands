import { useEffect, useState } from 'react';
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
  IconLink,
  IconMessage,
  IconPlus,
  IconTrash,
} from './icons';

interface Props {
  /** Gesamtes Feedback, seitenuebergreifend — das Panel gruppiert nach Seite. */
  items: FeedbackItem[];
  /** Aktuell geladene Seite (normalisiert). */
  url: string;
  /** Eingebaute + eigene Presets — bestimmt die Gruppierung. */
  presets: readonly DevicePreset[];
  devices: DeviceInstance[];
  onJump: (deviceId: string) => void;
  /** Wechselt die Previews auf eine andere Seite (Feedback-Herkunft). */
  onNavigate: (url: string) => void;
  onDelete: (itemId: string) => void;
  /** Erledigt-Status eines Eintrags umschalten. */
  onToggleDone: (itemId: string) => void;
  onClearAll: () => void;
  onCopy: () => Promise<void>;
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
  if (shape.tool !== 'pen' && shape.note) return `${TOOL_LABELS[shape.tool]} — ${shape.note}`;
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

export function FeedbackPanel({
  items,
  url,
  presets,
  devices,
  onJump,
  onNavigate,
  onDelete,
  onToggleDone,
  onClearAll,
  onCopy,
  onBuildShareLink,
  onExportScreenshots,
  onClose,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hideDone, setHideDone] = useState(false);

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const [shotsPending, setShotsPending] = useState(false);
  const [shotsCount, setShotsCount] = useState<number | null>(null);
  const [shotsProgress, setShotsProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!shareCopied) return;
    const timer = window.setTimeout(() => setShareCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [shareCopied]);

  // Der Link codiert den Feedback-Stand — bei Aenderungen veraltet er.
  useEffect(() => {
    setShareUrl(null);
    setShareError(false);
    setShotsCount(null);
  }, [items]);

  const createShareLink = () => {
    setShareError(false);
    setShotsCount(null);
    onBuildShareLink()
      .then(setShareUrl)
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

  // Nach Seite gruppiert (aktuelle zuerst), innerhalb nach Device-Preset.
  const byUrl = new Map<string, FeedbackItem[]>();
  for (const item of items) {
    const list = byUrl.get(item.url);
    if (list) list.push(item);
    else byUrl.set(item.url, [item]);
  }
  const pages = [...byUrl.entries()].sort(([a], [b]) =>
    a === url ? -1 : b === url ? 1 : a.localeCompare(b),
  );

  const pageCount = byUrl.get(url)?.length ?? 0;
  const openCount = items.filter((item) => !item.done).length;

  return (
    <aside className="panel panel--right" aria-label="Feedback">
      <div className="panel__head">
        <span className="panel__title">Feedback</span>
        {openCount > 0 && <span className="panel__count">{openCount}</span>}
        <span className="panel__spacer" />
        <button
          className="icon-btn icon-btn--small"
          title={copied ? 'Copied!' : "Copy this page's feedback as text"}
          disabled={pageCount === 0}
          onClick={() => {
            void onCopy().then(() => setCopied(true));
          }}
        >
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
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
            Pick a tool from the palette and mark elements, drop pins or draw on a device.
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
            <div key={pageUrl} className={`fb-page${isCurrent ? '' : ' fb-page--other'}`}>
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
                  <section key={preset.id} className="fb-group">
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
                      {visible.map((item) => (
                        <li
                          key={item.id}
                          className={`fb-item${item.done ? ' fb-item--done' : ''}`}
                          title={
                            isCurrent
                              ? shapeLabel(item.shape)
                              : `${shapeLabel(item.shape)} — click to switch to this page`
                          }
                          onClick={() => (isCurrent ? onJump(preset.id) : onNavigate(pageUrl))}
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
                            <span className="fb-item__pin" style={{ background: item.shape.color }}>
                              {numbers.get(item.shape.id)}
                            </span>
                          ) : (
                            <span className="fb-item__dot" style={{ background: item.shape.color }} />
                          )}
                          <span className="fb-item__label">{shapeLabel(item.shape)}</span>
                          <button
                            className="icon-btn icon-btn--small fb-item__delete"
                            title="Delete entry"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(item.id);
                            }}
                          >
                            <IconClose size={12} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          );
        })}
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
              <div className="share-hint">
                All markings of this page are encoded in the link. Anyone opening it with
                the Inkspect extension sees them directly on the page.
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
            <div className="share-hint share-hint--error">
              The link could not be created.
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
