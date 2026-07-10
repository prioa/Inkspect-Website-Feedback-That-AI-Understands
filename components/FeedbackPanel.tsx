import { useEffect, useState } from 'react';
import { PRESETS, type DeviceInstance } from '@/lib/devices';
import type { Shape } from '@/lib/annotations';
import { pinNumbers, TOOL_LABELS } from '@/lib/annotations';
import type { FeedbackItem } from '@/lib/feedbackStore';
import {
  IconCheck,
  IconClose,
  IconCopy,
  IconDots,
  IconLink,
  IconMessage,
  IconPlus,
  IconTerminal,
  IconTrash,
} from './icons';

interface Props {
  /** Gesamtes Feedback, seitenuebergreifend — das Panel gruppiert nach Seite. */
  items: FeedbackItem[];
  /** Aktuell geladene Seite (normalisiert). */
  url: string;
  devices: DeviceInstance[];
  onJump: (deviceId: string) => void;
  /** Wechselt die Previews auf eine andere Seite (Feedback-Herkunft). */
  onNavigate: (url: string) => void;
  onDelete: (itemId: string) => void;
  onClearAll: () => void;
  onCopy: () => Promise<void>;
  /** Baut die Share-URL (Feedback deflate+base64url im Hash). */
  onBuildShareLink: () => Promise<string>;
  /** Baut den Umsetzungs-Prompt fuer Claude Code. */
  onBuildClaudePrompt: () => string;
  onClose: () => void;
}

/** Anzeigetext eines Eintrags: Notiz/Text wenn vorhanden, sonst Element/Werkzeug-Label. */
function shapeLabel(shape: Shape): string {
  if (shape.tool === 'pin' || shape.tool === 'text') return shape.text || TOOL_LABELS[shape.tool];
  if (shape.tool === 'element') return shape.note ? `${shape.label} — ${shape.note}` : shape.label;
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
  devices,
  onJump,
  onNavigate,
  onDelete,
  onClearAll,
  onCopy,
  onBuildShareLink,
  onBuildClaudePrompt,
  onClose,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const [prompt, setPrompt] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);

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

  useEffect(() => {
    if (!promptCopied) return;
    const timer = window.setTimeout(() => setPromptCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [promptCopied]);

  // Link und Prompt codieren den Feedback-Stand — bei Aenderungen veralten sie.
  useEffect(() => {
    setShareUrl(null);
    setShareError(false);
    setPrompt(null);
  }, [items]);

  const createShareLink = () => {
    setShareError(false);
    setPrompt(null);
    onBuildShareLink()
      .then(setShareUrl)
      .catch(() => setShareError(true));
  };

  const copyShareLink = () => {
    if (!shareUrl) return;
    void navigator.clipboard.writeText(shareUrl).then(() => setShareCopied(true));
  };

  const createPrompt = () => {
    const text = onBuildClaudePrompt();
    setShareUrl(null);
    setShareError(false);
    setPrompt(text);
    // Direkt mitkopieren; die Vorschau bleibt auch ohne Clipboard-Rechte nutzbar.
    void navigator.clipboard
      .writeText(text)
      .then(() => setPromptCopied(true))
      .catch(() => {});
  };

  const copyPrompt = () => {
    if (!prompt) return;
    void navigator.clipboard.writeText(prompt).then(() => setPromptCopied(true));
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

  return (
    <aside className="panel panel--right" aria-label="Feedback">
      <div className="panel__head">
        <span className="panel__title">Feedback</span>
        {items.length > 0 && <span className="panel__count">{items.length}</span>}
        <span className="panel__spacer" />
        <button
          className="icon-btn icon-btn--small"
          title={copied ? 'Kopiert!' : 'Feedback dieser Seite als Text kopieren'}
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
            title="Verwalten"
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
                  <span className="menu__item-name">Alles loeschen (diese Seite)</span>
                </button>
              </div>
            </>
          )}
        </span>

        <button className="icon-btn icon-btn--small" title="Panel schliessen" onClick={onClose}>
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
            Noch kein Feedback.
            <br />
            Aktiviere den Stift an einem Device und markiere Elemente, setze Pins oder zeichne.
          </p>
        </div>
      )}

      <div className="panel__scroll">
        {pages.map(([pageUrl, pageItems]) => {
          const isCurrent = pageUrl === url;
          const groups = PRESETS.map((preset) => ({
            preset,
            items: pageItems.filter((item) => item.deviceId === preset.id),
          })).filter((g) => g.items.length > 0);

          return (
            <div key={pageUrl} className={`fb-page${isCurrent ? '' : ' fb-page--other'}`}>
              {(pages.length > 1 || !isCurrent) && (
                <button
                  className="fb-page__head"
                  title={isCurrent ? 'Aktuelle Seite' : 'Previews auf diese Seite wechseln'}
                  disabled={isCurrent}
                  onClick={() => onNavigate(pageUrl)}
                >
                  <span className="fb-page__path">{pathOf(pageUrl)}</span>
                  {isCurrent && <span className="fb-page__badge">aktuell</span>}
                </button>
              )}

              {groups.map(({ preset, items: groupItems }) => {
                const inGrid = devices.some((d) => d.id === preset.id);
                const numbers = pinNumbers(groupItems.map((i) => i.shape));
                return (
                  <section key={preset.id} className="fb-group">
                    <button
                      className="fb-group__head"
                      title={
                        isCurrent
                          ? inGrid
                            ? 'Zum Device springen'
                            : 'Device ins Grid holen'
                          : 'Previews auf diese Seite wechseln'
                      }
                      onClick={() => (isCurrent ? onJump(preset.id) : onNavigate(pageUrl))}
                    >
                      <span className="fb-group__name">{preset.name}</span>
                      <span className="fb-group__size">
                        {preset.width}×{preset.height}
                      </span>
                      {isCurrent && !inGrid && (
                        <span className="fb-group__add">
                          <IconPlus size={12} />
                        </span>
                      )}
                    </button>

                    <ul className="fb-list">
                      {groupItems.map((item) => (
                        <li
                          key={item.id}
                          className="fb-item"
                          title={
                            isCurrent
                              ? shapeLabel(item.shape)
                              : `${shapeLabel(item.shape)} — Klick wechselt zur Seite`
                          }
                          onClick={() => (isCurrent ? onJump(preset.id) : onNavigate(pageUrl))}
                        >
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
                            title="Eintrag loeschen"
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

      {pageCount > 0 && (
        <div className="panel__share">
          <div className="share-row">
            <button className="share-btn" onClick={createShareLink}>
              <IconLink size={14} />
              Als Link teilen
            </button>
            <button className="share-btn share-btn--alt" onClick={createPrompt}>
              <IconTerminal size={14} />
              Claude-Prompt
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
                  title={shareCopied ? 'Kopiert!' : 'Link kopieren'}
                  onClick={copyShareLink}
                >
                  {shareCopied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                </button>
              </div>
              <div className="share-hint">
                Alle Markierungen dieser Seite stecken codiert im Link. Wer ihn mit
                Inkspect-Extension oeffnet, sieht sie direkt auf der Seite.
              </div>
            </>
          )}

          {prompt !== null && (
            <>
              <div className="share-box share-box--multiline">
                <textarea
                  className="share-box__prompt"
                  readOnly
                  value={prompt}
                  spellCheck={false}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  className="icon-btn icon-btn--small"
                  title={promptCopied ? 'Kopiert!' : 'Prompt kopieren'}
                  onClick={copyPrompt}
                >
                  {promptCopied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                </button>
              </div>
              <div className="share-hint">
                {promptCopied ? 'In der Zwischenablage — ' : ''}in Claude Code einfuegen:
                enthaelt Selektoren, Notizen und Viewports aller Markierungen dieser Seite.
              </div>
            </>
          )}

          {shareError && (
            <div className="share-hint share-hint--error">
              Link konnte nicht erstellt werden.
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
