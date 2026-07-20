import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t, type MessageKey } from '@/lib/i18n';
import { IconClose } from './icons';

/**
 * Live-Zustand der Shell, den die Tour braucht: Aktions-Schritte rasten
 * daran weiter (Palette geoeffnet) und Schritte, die auf ein Element zeigen,
 * das es gerade nicht gibt, springen zurueck.
 */
export interface TourState {
  paletteOpen: boolean;
}

interface Step {
  /** Auf welches Element gezeigt wird — der erste Treffer gewinnt. Mehrere
   *  Selektoren ergeben die umschliessende Box (z.B. beide Linien-Tools). */
  anchor?: string[];
  title: MessageKey;
  body: MessageKey;
  /** Extra-Rand um das Loch herum. */
  pad?: number;
  /** Aktions-Schritt: rastet von selbst weiter, sobald das zutrifft. */
  advanceWhen?: (s: TourState) => boolean;
  /** Vorbedingung — faellt sie weg, springt die Tour zum letzten Schritt zurueck,
   *  dessen Vorbedingung noch haelt. */
  needs?: (s: TourState) => boolean;
}

const paletteOpen = (s: TourState) => s.paletteOpen;

const STEPS: Step[] = [
  { title: 'tour1Title', body: 'tour1Body' },
  { title: 'tour2Title', body: 'tour2Body', anchor: ['.device__bar'], pad: 4 },
  {
    title: 'tour3Title',
    body: 'tour3Body',
    anchor: ['.device__viewport'],
    pad: 0,
    advanceWhen: paletteOpen,
  },
  { title: 'tour4Title', body: 'tour4Body', anchor: ['.palette'], needs: paletteOpen },
  {
    title: 'tour5Title',
    body: 'tour5Body',
    anchor: ['.palette [data-tool="hline"]', '.palette [data-tool="vline"]'],
    pad: 4,
    needs: paletteOpen,
  },
  { title: 'tour6Title', body: 'tour6Body' },
  { title: 'tour7Title', body: 'tour7Body', anchor: ['.toolbar__feedback'], pad: 4 },
  { title: 'tour8Title', body: 'tour8Body' },
];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Umschliessende Box aller Treffer — leer, wenn keiner sichtbar ist.
 *
 * Gesucht wird im Shadow Root der Shell, nicht im Dokument: die gesamte UI
 * haengt dort drin und waere ueber `document` unsichtbar. Die Rects sind
 * trotzdem Viewport-Koordinaten, weil der Host `position: fixed; inset: 0` ist.
 */
function measure(root: ParentNode, selectors: string[] | undefined, pad: number): Rect | null {
  if (!selectors) return null;
  let box: Rect | null = null;
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    box = box
      ? {
          x: Math.min(box.x, r.left),
          y: Math.min(box.y, r.top),
          w: Math.max(box.x + box.w, r.right) - Math.min(box.x, r.left),
          h: Math.max(box.y + box.h, r.bottom) - Math.min(box.y, r.top),
        }
      : { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  if (!box) return null;
  return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.w - b.w) < 0.5 &&
    Math.abs(a.h - b.h) < 0.5
  );
}

const CARD_W = 340;
const GAP = 14;

/** Karte unter das Loch, sonst darueber, sonst mittig — immer im Fenster. */
function placeCard(hole: Rect | null, cardH: number): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!hole) {
    return { left: Math.round((vw - CARD_W) / 2), top: Math.round((vh - cardH) / 2) };
  }
  const below = hole.y + hole.h + GAP;
  const above = hole.y - GAP - cardH;
  const top = below + cardH <= vh - 8 ? below : above >= 8 ? above : Math.max(8, (vh - cardH) / 2);
  const wanted = hole.x + hole.w / 2 - CARD_W / 2;
  const left = Math.max(8, Math.min(wanted, vw - CARD_W - 8));
  return { left: Math.round(left), top: Math.round(top) };
}

/**
 * Gefuehrte Erst-Tour mit Spotlight: dimmt alles ausser dem erklaerten
 * Element und setzt eine Karte daneben. Das Loch ist ein echtes Loch — die
 * vier Dimm-Flaechen lassen es aus, deshalb bleibt das hervorgehobene
 * Element anklickbar und Aktions-Schritte („rechtsklick jetzt") rasten von
 * selbst weiter.
 */
export function Tour({
  root,
  state,
  index,
  onIndex,
  onClose,
}: {
  /** Shadow Root der Shell — dort liegen die Anker-Elemente. */
  root: ParentNode;
  state: TourState;
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
}) {
  // Der Index wird von aussen gesetzt (Menue-Neustart, Zurueckspringen) —
  // hart klemmen, statt bei einem Ausreisser leer zu rendern.
  const safeIndex = Math.max(0, Math.min(index, STEPS.length - 1));
  const step = STEPS[safeIndex] as Step;
  const pad = step.pad ?? 8;
  const [hole, setHole] = useState<Rect | null>(() => measure(root, step.anchor, pad));
  const [cardH, setCardH] = useState(190);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Vorbedingung weggefallen (Palette zugeklickt) — zurueck zum letzten
  // Schritt, der ohne sie auskommt.
  useEffect(() => {
    if (step.needs && !step.needs(state)) {
      let back = safeIndex - 1;
      while (back > 0 && (STEPS[back] as Step).needs?.(state) === false) back--;
      onIndex(back);
    }
  }, [step, state, safeIndex, onIndex]);

  // Aktions-Schritt: die Geste sass, weiter.
  useEffect(() => {
    if (step.advanceWhen?.(state)) onIndex(safeIndex + 1);
  }, [step, state, safeIndex, onIndex]);

  // Anker koennen sich unter uns bewegen (Grid-Umbruch, Palette an neuer
  // Stelle, Fenstergroesse). Statt jedes Ereignis einzeln abzufangen wird
  // pro Frame nachgemessen und nur bei echter Aenderung gerendert.
  useEffect(() => {
    let raf = 0;
    let last: Rect | null = null;
    const tick = () => {
      const next = measure(root, step.anchor, pad);
      if (!sameRect(next, last)) {
        last = next;
        setHole(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [root, step, pad]);

  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h) setCardH(h);
  }, [step, safeIndex]);

  const next = useCallback(() => {
    if (safeIndex >= STEPS.length - 1) onClose();
    else onIndex(safeIndex + 1);
  }, [safeIndex, onIndex, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowRight') {
        e.stopPropagation();
        next();
      } else if (e.key === 'ArrowLeft' && safeIndex > 0) {
        e.stopPropagation();
        onIndex(safeIndex - 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [next, onClose, onIndex, safeIndex]);

  const card = useMemo(() => placeCard(hole, cardH), [hole, cardH]);

  // Die vier Flaechen rund um das Loch. Ohne Anker deckt eine einzige alles ab.
  const shades: Rect[] = useMemo(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!hole) return [{ x: 0, y: 0, w: vw, h: vh }];
    const x0 = Math.max(0, hole.x);
    const x1 = Math.min(vw, hole.x + hole.w);
    const y0 = Math.max(0, hole.y);
    const y1 = Math.min(vh, hole.y + hole.h);
    return [
      { x: 0, y: 0, w: vw, h: y0 },
      { x: 0, y: y1, w: vw, h: vh - y1 },
      { x: 0, y: y0, w: x0, h: y1 - y0 },
      { x: x1, y: y0, w: vw - x1, h: y1 - y0 },
    ].filter((r) => r.w > 0 && r.h > 0);
  }, [hole]);

  const waiting = Boolean(step.advanceWhen);

  return (
    <div className="tour" role="dialog" aria-modal="false" aria-label={t(step.title)}>
      {shades.map((r, i) => (
        <div
          key={i}
          className="tour__shade"
          style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
          // Ein Klick daneben beendet die Tour nicht — sonst verliert man sie
          // beim ersten Fehlgriff. Nur der Skip-Button raeumt sie weg.
          onClick={(e) => e.stopPropagation()}
        />
      ))}

      {hole && (
        <div
          className="tour__ring"
          style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }}
        />
      )}

      <div ref={cardRef} className="tour__card" style={{ left: card.left, top: card.top }}>
        <div className="tour__head">
          <span className="tour__title">{t(step.title)}</span>
          <button className="icon-btn icon-btn--small" title={t('tourSkip')} onClick={onClose}>
            <IconClose size={14} />
          </button>
        </div>

        <p className="tour__body">{t(step.body)}</p>

        {waiting && <p className="tour__waiting">{t('tourWaiting')}</p>}

        <div className="tour__foot">
          <span className="tour__dots" aria-label={t('tourStepOf', safeIndex + 1, STEPS.length)}>
            {STEPS.map((s, i) => (
              <span key={s.title} className={`tour__dot${i === safeIndex ? ' tour__dot--on' : ''}`} />
            ))}
          </span>
          <span className="tour__actions">
            {safeIndex > 0 && (
              <button className="tour__btn" onClick={() => onIndex(safeIndex - 1)}>
                {t('tourBack')}
              </button>
            )}
            {!waiting && (
              <button className="tour__btn tour__btn--primary" onClick={next}>
                {safeIndex >= STEPS.length - 1 ? t('tourDone') : t('tourNext')}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
