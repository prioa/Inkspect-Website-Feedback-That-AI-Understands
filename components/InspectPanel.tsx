import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, HTMLAttributes, PointerEvent as ReactPointerEvent } from 'react';
import type { SelectedTarget, StyleChange, TextChange } from '@/lib/annotations';
import {
  IconClose,
  IconHelp,
  IconLink,
  IconLinkOff,
  IconPin,
  IconUndo,
  IconWarning,
} from './icons';

/** Auswahl fuer den Font-Weight-Regler des Element-Pickers. */
const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
/** Gelaeufige Namen der Font-Weights fuer die Dropdown-Beschriftung. */
const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semi Bold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
};

/** So viele Aenderungen stehen offen da — der Rest kommt hinter „+n more". */
const CHANGES_PREVIEW = 3;

export type SpacingKind = 'margin' | 'padding';
export type Edge = 'top' | 'right' | 'bottom' | 'left';
/** Margin und Padding lassen sich getrennt voneinander verknuepfen. */
export type LinkedSides = Record<SpacingKind, boolean>;

const EDGES = ['top', 'right', 'bottom', 'left'] as const satisfies readonly Edge[];
const EDGE_KEY = { top: 't', right: 'r', bottom: 'b', left: 'l' } as const;

/**
 * Ein Eintrag der Aenderungsliste. Text- und Stil-Aenderungen werden hier zu
 * einer Liste vereint, damit „die ersten drei" ueber beide hinweg zaehlt.
 */
interface ChangeEntry {
  key: string;
  prop: string;
  from: string;
  to: string;
  /** Textwerte sind lang und duerfen umbrechen. */
  long?: boolean;
  onRevert: () => void;
}

export interface InspectPanelProps {
  sel: SelectedTarget;
  /** Farbe des aktiven Werkzeugs — faerbt Rahmen und Kopf-Punkt. */
  color: string;
  /** Viewport-Position aus `popupPlacement`. */
  placement: CSSProperties;
  dragging: boolean;
  scope: 'class' | 'element';
  classSel: string | null;
  /** Wie viele Elemente die Klassenregel tatsaechlich trifft. */
  classMatches: number;
  linked: LinkedSides;
  changes: StyleChange[];
  textChange: TextChange | null;
  /** Aktueller Inhalt des Textfelds (Entwurf, nicht die Messung). */
  textValue: string;
  note: string;
  /** Wieder geoeffneter Marker — der Hauptknopf heisst dann „Update". */
  isEditing: boolean;
  /** Fuer die Groessenmessung der Platzierung. */
  panelRef: (node: HTMLDivElement | null) => void;
  /** Fertige Drag-Handler fuer die Kopfzeile. */
  headProps: HTMLAttributes<HTMLDivElement>;
  onScope: (scope: 'class' | 'element') => void;
  onToggleLink: (kind: SpacingKind) => void;
  onSpacing: (kind: SpacingKind, edge: Edge, value: number) => void;
  onStyle: (prop: string, value: string) => void;
  onText: (value: string) => void;
  onNote: (value: string) => void;
  onRevertChange: (change: StyleChange) => void;
  onRevertText: () => void;
  onReset: () => void;
  onCommit: () => void;
  onClose: () => void;
}

/**
 * Bearbeiten-Popup des Element-Pickers: Text, Box-Model, Font, offene
 * Aenderungen und Notiz zum Marker. Reine Darstellung — geschrieben wird
 * ausschliesslich ueber die Callbacks in `AnnotationOverlay`.
 */
export function InspectPanel({
  sel,
  color,
  placement,
  dragging,
  scope,
  classSel,
  classMatches,
  linked,
  changes,
  textChange,
  textValue,
  note,
  isEditing,
  panelRef,
  headProps,
  onScope,
  onToggleLink,
  onSpacing,
  onStyle,
  onText,
  onNote,
  onRevertChange,
  onRevertText,
  onReset,
  onCommit,
  onClose,
}: InspectPanelProps) {
  const inClass = scope === 'class' && !!classSel;
  /**
   * Selektor des Elements, dessen Textfeld schon fokussiert wurde. Klickt man
   * einen Text an, springt der Cursor sofort ins Feld — aber nur einmal je
   * Auswahl, sonst risse jedes Neu-Vermessen beim Tippen den Fokus zurueck.
   */
  const focusedFor = useRef<string | null>(null);
  const [showAllChanges, setShowAllChanges] = useState(false);
  /** Ein anderes Element = wieder nur die Vorschau zeigen. */
  useEffect(() => setShowAllChanges(false), [sel.selector]);
  /**
   * Breite und Randabstand ergeben sich aus dem Layout statt aus festen Werten
   * — die angezeigten Zahlen sind dort nur Messwerte, keine Stellschrauben.
   */
  const hasAutoMargin = EDGES.some((e) => sel.autoMargin[EDGE_KEY[e]]);
  const constrained = hasAutoMargin || sel.maxWidthRaw != null;

  const entries: ChangeEntry[] = [
    ...(textChange
      ? [
          {
            key: 'text',
            prop: 'text',
            from: textChange.from,
            to: textChange.to,
            long: true,
            onRevert: onRevertText,
          },
        ]
      : []),
    ...changes.map((c) => ({
      key: c.prop,
      prop: c.prop,
      from: c.from,
      to: c.to,
      onRevert: () => onRevertChange(c),
    })),
  ];
  const hasEdits = entries.length > 0;

  return (
    <div
      ref={panelRef}
      className={`anno__inspect${dragging ? ' is-dragging' : ''}`}
      style={{ ...placement, borderColor: color }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="anno__inspect-top">
        <div className="anno__inspect-head" title="Drag to move" {...headProps}>
          <span className="anno__inspect-dot" style={{ background: color }} />
          <span className="anno__inspect-title" title={sel.selector}>
            {sel.label}
          </span>
          <span className="anno__inspect-dims">
            {Math.round(sel.w)} × {Math.round(sel.h)}
          </span>
          <button
            type="button"
            className="anno__ibtn"
            title="Close (Esc)"
            aria-label="Close"
            onClick={onClose}
          >
            <IconClose size={15} />
          </button>
        </div>

        <div className="anno__scope">
          <div className="anno__seg" role="group" aria-label="Edit scope">
            <button
              type="button"
              className={inClass ? 'is-active' : ''}
              disabled={!classSel}
              onClick={() => onScope('class')}
              title={classSel ? `Edit every ${classSel}` : 'Element has no class'}
            >
              Class
            </button>
            <button
              type="button"
              className={!inClass ? 'is-active' : ''}
              onClick={() => onScope('element')}
              title="Edit only this element"
            >
              Element
            </button>
          </div>
          {/* Sagt, was eine Aenderung wirklich trifft — bei Klassen-Scope also
              den Selektor und wie viele Elemente daran haengen. */}
          <span
            className="anno__scope-sel"
            title={
              inClass
                ? `${classSel} — ${classMatches} element${classMatches === 1 ? '' : 's'} on the page`
                : 'Changes apply to this element only'
            }
          >
            {inClass ? (
              <>
                {classSel}
                <em className="anno__scope-count"> · {classMatches}×</em>
              </>
            ) : classSel ? (
              'only this element'
            ) : (
              'no class — element only'
            )}
          </span>
        </div>
      </div>

      {/* Wer einen Text anklickt, will ihn meist umschreiben — deshalb steht
          das Textfeld vor Abstaenden und Schrift und bekommt den Fokus. */}
      {sel.hasText && (
        <div className="anno__inspect-text">
          {/* Statt „Text“ das Element selbst — man sieht sofort, ob man gerade
              eine Ueberschrift, einen Absatz oder ein Inline-Span umschreibt. */}
          <span
            className="anno__inspect-row-label anno__tag-label"
            title={`Direct text of <${sel.tag}>`}
          >
            &lt;{sel.tag}&gt;
          </span>
          <textarea
            className="anno__text-in"
            rows={2}
            value={textValue}
            spellCheck={false}
            aria-label="Element text"
            title="Rewrite the text on the page"
            ref={(node) => {
              if (!node || focusedFor.current === sel.selector) return;
              focusedFor.current = sel.selector;
              node.focus();
              // Cursor ans Ende statt alles zu markieren — ein Tippfehler
              // soll nicht den ganzen Text ueberschreiben.
              const end = node.value.length;
              node.setSelectionRange(end, end);
            }}
            onChange={(ev) => onText(ev.target.value)}
            onKeyDown={(ev) => {
              // Wie im Notizfeld: Enter uebernimmt, Shift+Enter bricht um.
              if (ev.key === 'Enter' && !ev.shiftKey) {
                ev.preventDefault();
                onCommit();
              }
            }}
          />
        </div>
      )}

      {/* Schrift gehoert zum Text und steht deshalb direkt darunter. */}
      {sel.hasText && (
        <div className="anno__inspect-row">
          <span className="anno__inspect-row-label">Font</span>
          <select
            className="anno__inspect-weight"
            value={sel.fontWeight}
            aria-label="Font weight"
            title={`Weight ${sel.fontWeight}${
              WEIGHT_NAMES[sel.fontWeight] ? ` · ${WEIGHT_NAMES[sel.fontWeight]}` : ''
            }`}
            onChange={(ev) => onStyle('font-weight', ev.target.value)}
          >
            {!FONT_WEIGHTS.includes(sel.fontWeight) && (
              <option value={sel.fontWeight}>{sel.fontWeight}</option>
            )}
            {FONT_WEIGHTS.map((w) => (
              <option key={w} value={w}>
                {WEIGHT_NAMES[w] ? `${w} · ${WEIGHT_NAMES[w]}` : w}
              </option>
            ))}
          </select>
          <div className="anno__inspect-size">
            <NumberField
              className="anno__font-in"
              ariaLabel="Font size"
              title="Font size · drag to change"
              min={1}
              value={Math.round(sel.fontSize)}
              onValue={(v) => onStyle('font-size', `${Math.max(1, v)}px`)}
            />
            <span className="anno__inspect-unit">px</span>
          </div>
        </div>
      )}

      {/* Bei einem begrenzten Container ist max-width der eigentliche Hebel —
          die Margins ringsum sind nur dessen Ergebnis. Beides wird vorerst nur
          angezeigt, siehe Hinweis unter der Tabelle. */}
      {sel.maxWidthRaw != null && (
        <div className="anno__inspect-row">
          <span className="anno__inspect-row-label">Width</span>
          <span className="anno__inspect-prop">max-width</span>
          <span className="anno__inspect-static" title="Read-only for now">
            {sel.maxWidthRaw}
          </span>
        </div>
      )}

      <SpacingBox sel={sel} linked={linked} onToggleLink={onToggleLink} onSpacing={onSpacing} />

      {constrained && (
        <p className="anno__sp-warn">
          <IconWarning size={12} />
          <span>
            This box is laid out by its container
            {hasAutoMargin ? ' and centred with auto margins' : ''}. Writing a fixed pixel value
            there would break it at other widths, so{' '}
            {hasAutoMargin ? <b>max-width and auto margins</b> : <b>max-width</b>} stay read-only —
            editing them is coming in a feature update. Padding still works.
          </span>
        </p>
      )}

      {hasEdits && (
        <ChangeList
          entries={entries}
          showAll={showAllChanges}
          onToggleAll={() => setShowAllChanges((v) => !v)}
        />
      )}

      {/* Gleicher Aufbau wie das Textfeld — sonst sind die beiden dunklen
          Kaesten nicht auseinanderzuhalten, sobald etwas drinsteht. */}
      <div className="anno__inspect-text">
        <span className="anno__inspect-row-label">Note</span>
        <textarea
          className="anno__text-in"
          value={note}
          spellCheck={false}
          rows={2}
          placeholder="What should change here?"
          aria-label="Marker note"
          onChange={(ev) => onNote(ev.target.value)}
          onKeyDown={(ev) => {
            // Enter uebernimmt Element + Notiz als Marker (Shift+Enter = Umbruch);
            // Escape laeuft an den Popup-Handler durch und schliesst.
            if (ev.key === 'Enter' && !ev.shiftKey) {
              ev.preventDefault();
              onCommit();
            }
          }}
        />
      </div>

      <div className="anno__inspect-foot">
        <span
          className="anno__inspect-hint"
          tabIndex={0}
          title="Saved changes stay applied while their marker is visible — hide or delete the feedback to remove them"
        >
          <IconHelp size={15} />
        </span>
        <div className="anno__inspect-actions">
          <button
            type="button"
            className="anno__inspect-btn"
            onClick={onReset}
            disabled={!hasEdits}
            title={hasEdits ? 'Revert all changes' : 'Nothing changed yet'}
          >
            <IconUndo size={13} />
            Reset
          </button>
          <button
            type="button"
            className="anno__inspect-btn anno__inspect-mark"
            onClick={onCommit}
            title={
              isEditing
                ? 'Update this marker'
                : hasEdits
                  ? 'Save element + changes to feedback'
                  : 'Add element to feedback'
            }
          >
            <IconPin size={13} />
            {isEditing ? 'Update' : hasEdits ? 'Save' : 'Marker'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Abstaende als schmale Tabelle: eine Zeile je Eigenschaft, Spalten T/R/B/L,
 * am Ende der Ketten-Knopf. Der Farbpunkt vor dem Namen ordnet die Zeile dem
 * Rahmen im Overlay zu.
 */
function SpacingBox({
  sel,
  linked,
  onToggleLink,
  onSpacing,
}: {
  sel: SelectedTarget;
  linked: LinkedSides;
  onToggleLink: (kind: SpacingKind) => void;
  onSpacing: (kind: SpacingKind, edge: Edge, value: number) => void;
}) {
  const row = (kind: SpacingKind) => (
    <>
      <span className="anno__sp-lab">
        <i className={`anno__sp-dot anno__sp-dot--${kind[0]}`} />
        {kind}
      </span>
      {EDGES.map((edge) => {
        const value = Math.round(sel[kind][EDGE_KEY[edge]]);
        if (kind === 'margin' && sel.autoMargin[EDGE_KEY[edge]]) {
          // Gesperrt statt Zahlenfeld: der gemessene Wert ist nur das Ergebnis
          // von `auto`. Ihn zurueckzuschreiben ersetzt die Zentrierung.
          return (
            <span
              key={edge}
              className="anno__sp-auto"
              title={`margin-${edge} is auto — currently ${value}px, not editable yet`}
            >
              auto
            </span>
          );
        }
        return (
          <NumberField
            key={edge}
            className={`anno__sp-in${value === 0 ? ' is-zero' : ''}`}
            ariaLabel={`${kind} ${edge}`}
            title={`${kind}-${edge} · drag to change`}
            min={kind === 'padding' ? 0 : undefined}
            value={value}
            onValue={(v) => onSpacing(kind, edge, v)}
          />
        );
      })}
      <button
        type="button"
        className={`anno__link${linked[kind] ? ' is-active' : ''}`}
        aria-pressed={linked[kind]}
        onClick={() => onToggleLink(kind)}
        title={
          linked[kind]
            ? `${kind}: sides linked — one edit changes all four`
            : `${kind}: link all four sides`
        }
      >
        {linked[kind] ? <IconLink size={12} /> : <IconLinkOff size={12} />}
      </button>
    </>
  );

  return (
    <div className="anno__spacing">
      <span className="anno__sp-unit">px</span>
      {EDGES.map((edge) => (
        <span key={edge} className="anno__sp-h" title={edge}>
          {edge[0]!.toUpperCase()}
        </span>
      ))}
      <span />
      {row('margin')}
      {row('padding')}
    </div>
  );
}

/**
 * Offene Aenderungen als Chips. Die ersten drei stehen immer da, der Rest
 * klappt auf — und jede laesst sich einzeln zuruecknehmen.
 */
function ChangeList({
  entries,
  showAll,
  onToggleAll,
}: {
  entries: ChangeEntry[];
  showAll: boolean;
  onToggleAll: () => void;
}) {
  const hidden = entries.length - CHANGES_PREVIEW;
  const shown = showAll ? entries : entries.slice(0, CHANGES_PREVIEW);
  return (
    <div className="anno__changes" aria-label="Pending changes">
      <span className="anno__changes-cap">Changes ({entries.length})</span>
      <div className="anno__changes-list">
        {shown.map((e) => (
          <span className={`anno__chg${e.long ? ' anno__chg--text' : ''}`} key={e.key}>
            <span className="anno__chg-prop">{e.prop}</span>
            <span className="anno__chg-from">{e.from}</span>
            <span className="anno__chg-arr">→</span>
            <span className="anno__chg-to">{e.to}</span>
            <button
              type="button"
              className="anno__chg-x"
              onClick={e.onRevert}
              title={`Revert ${e.prop}`}
              aria-label={`Revert ${e.prop}`}
            >
              <IconClose size={10} />
            </button>
          </span>
        ))}
      </div>
      {hidden > 0 && (
        <button type="button" className="anno__chg-more" onClick={onToggleAll} aria-expanded={showAll}>
          {showAll ? '▾ Show less' : `▸ ${hidden} more`}
        </button>
      )}
    </div>
  );
}

/**
 * Zahlenfeld mit Scrub-Gestik: Klick fokussiert (Tippen), Ziehen aendert den
 * Wert direkt (Figma/DevTools-Standard). Shift ziehen = 10er-Schritte.
 */
function NumberField({
  className,
  ariaLabel,
  title,
  min,
  value,
  onValue,
}: {
  className: string;
  ariaLabel: string;
  title: string;
  min?: number;
  value: number;
  onValue: (v: number) => void;
}) {
  const scrub = useRef<{ startX: number; startVal: number; moved: boolean; pointerId: number } | null>(
    null,
  );
  return (
    <input
      className={className}
      type="number"
      step={1}
      min={min}
      aria-label={ariaLabel}
      title={title}
      value={value}
      onChange={(ev) => onValue(Number(ev.target.value) || 0)}
      onPointerDown={(e: ReactPointerEvent<HTMLInputElement>) => {
        if (e.button !== 0) return;
        scrub.current = { startX: e.clientX, startVal: value, moved: false, pointerId: e.pointerId };
      }}
      onPointerMove={(e: ReactPointerEvent<HTMLInputElement>) => {
        const s = scrub.current;
        if (!s || s.pointerId !== e.pointerId) return;
        const dx = e.clientX - s.startX;
        if (!s.moved) {
          if (Math.abs(dx) < 3) return;
          s.moved = true;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* schon freigegeben */
          }
        }
        e.preventDefault(); // keine Textauswahl waehrend des Ziehens
        const step = e.shiftKey ? 10 : 1;
        onValue(s.startVal + Math.round((dx * 0.5) / step) * step);
      }}
      onPointerUp={(e: ReactPointerEvent<HTMLInputElement>) => {
        const s = scrub.current;
        scrub.current = null;
        if (s?.moved) {
          e.preventDefault();
          e.currentTarget.blur(); // nach dem Ziehen keinen Fokus behalten
        }
      }}
      onLostPointerCapture={() => {
        scrub.current = null;
      }}
    />
  );
}
