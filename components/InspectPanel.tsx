import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, HTMLAttributes, PointerEvent as ReactPointerEvent } from 'react';
import type { SelectedTarget, StyleChange, TextChange } from '@/lib/annotations';
import { useFireHint } from '@/lib/hints';
import { useHideTip, useTip } from './Tooltip';
import {
  IconClose,
  IconGrip,
  IconLink,
  IconLinkOff,
  IconPin,
  IconUndo,
  IconWarning,
} from './icons';

/** Choices for the element picker's font-weight control. */
const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
/** Common names of the font weights, for the dropdown labels. */
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

/** This many changes stand open — the rest sits behind "+n more". */
const CHANGES_PREVIEW = 3;

/**
 * Ceiling for the text boxes that grow with their content. Beyond it they
 * scroll: a page paragraph of twenty lines would otherwise push the save button
 * out of the popup, and the popup itself off the screen.
 */
const TEXT_MAX_H = 200;

/**
 * Lay a text box out around what is in it, instead of standing at a fixed
 * number of rows.
 *
 * The text field is filled with whatever the page happens to carry — a headline
 * of three words or a paragraph of six lines. Three rows fitted neither: short
 * texts sat in an empty box, and longer ones were cut off at the third line,
 * behind a scrollbar you had to find before you could see what you were
 * rewriting. The height is set on the element rather than through state,
 * because it has to be right in the same frame the value changes in — otherwise
 * the box visibly jumps a beat after every keystroke.
 */
function fitToText(el: HTMLTextAreaElement | null) {
  if (!el) return;
  // First back to nothing: `scrollHeight` never shrinks below the height
  // already set, so without this the box could only ever grow.
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight + 2, TEXT_MAX_H)}px`;
}

export type SpacingKind = 'margin' | 'padding';
export type Edge = 'top' | 'right' | 'bottom' | 'left';
/** Margin and padding can be linked independently of each other. */
export type LinkedSides = Record<SpacingKind, boolean>;

const EDGES = ['top', 'right', 'bottom', 'left'] as const satisfies readonly Edge[];
const EDGE_KEY = { top: 't', right: 'r', bottom: 'b', left: 'l' } as const;

/**
 * One entry of the change list. Text and style changes are merged into a
 * single list here, so that "the first three" counts across both.
 */
interface ChangeEntry {
  key: string;
  prop: string;
  from: string;
  to: string;
  /** Text values are long and may wrap. */
  long?: boolean;
  onRevert: () => void;
}

export interface InspectPanelProps {
  sel: SelectedTarget;
  /** Colour of the active tool — tints the frame and the header dot. */
  color: string;
  /** Viewport position from `popupPlacement`. */
  placement: CSSProperties;
  dragging: boolean;
  scope: 'class' | 'element';
  classSel: string | null;
  /** How many elements the class rule actually hits. */
  classMatches: number;
  linked: LinkedSides;
  changes: StyleChange[];
  textChange: TextChange | null;
  /** Current content of the text field (the draft, not the measurement). */
  textValue: string;
  note: string;
  /** A marker reopened — the main button then reads "Update". */
  isEditing: boolean;
  /** For measuring the size when placing it. */
  panelRef: (node: HTMLDivElement | null) => void;
  /** Ready-made drag handlers for the header. */
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
 * The element picker's edit popup: text, box model, font, open changes and the
 * marker's note. Display only — writing happens exclusively through the
 * callbacks in `AnnotationOverlay`.
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
   * Selector of the element whose text field has already been focused. Click a
   * text and the cursor jumps straight into the field — but only once per
   * selection, or every remeasurement while typing would pull the focus back.
   */
  const focusedFor = useRef<string | null>(null);
  /**
   * The two growing text boxes. A layout effect rather than a handler on the
   * change: both values are controlled from outside (a revert, a different
   * element, the text picked up from the page), and only the effect catches
   * those too.
   */
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const [showAllChanges, setShowAllChanges] = useState(false);
  /**
   * The default tab is deliberately lean: text (where there is any) and the
   * note. Everything technical — scope, font, box model, change list — lives in
   * the Style tab, so that the most common case ("rewrite it and note it") is
   * not buried under tools.
   */
  const [tab, setTab] = useState<'content' | 'style'>('content');
  // `tab` in the dependencies: a box that is not laid out measures nothing, so
  // both have to be fitted again the moment the Content tab comes back.
  useLayoutEffect(() => {
    fitToText(textRef.current);
  }, [textValue, tab]);
  useLayoutEffect(() => {
    fitToText(noteRef.current);
  }, [note, tab]);
  /** A different element = show only the preview again, tab back. */
  useEffect(() => {
    setShowAllChanges(false);
    setTab('content');
  }, [sel.selector]);

  const fire = useFireHint();
  const tip = useTip();
  const tipText = useTip();
  const hideTip = useHideTip();
  // How the two tabs divide the work is the one thing the popup does not show
  // by itself — rewriting text and changing looks appear identical.
  useEffect(() => {
    fire('first-element-pick');
  }, [fire]);
  // Class scope acts on elements you cannot even see at that moment.
  //
  // Whether the hint appears depends on whether the switch is visible right
  // now — for an element without text of its own it exists in neither tab.
  // That decision is made centrally via the anchor; here it is fired without
  // hesitation.
  useEffect(() => {
    if (inClass) fire('first-class-scope');
  }, [inClass, fire]);
  /**
   * Width and side spacing come out of the layout rather than fixed values —
   * the numbers shown there are measurements, not dials.
   */
  const hasAutoMargin = EDGES.some((e) => sel.autoMargin[EDGE_KEY[e]]);
  const constrained = hasAutoMargin || sel.maxWidthRaw != null;

  /** Id/class part of the label — the tag itself sits in the header chip. */
  const labelRest = sel.label.startsWith(sel.tag) ? sel.label.slice(sel.tag.length) : sel.label;

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
  /**
   * Does the marker carry anything at all? A note counts just as much as a
   * change — "this element is wrong" is the picker's most common case and needs
   * not one dialled number. Without either, an empty box with a label would be
   * left behind that nobody can interpret: the main button is then off and says
   * what is missing, instead of offering to save.
   */
  const hasNote = note.trim().length > 0;
  const canCommit = hasEdits || hasNote;

  /**
   * The one way to save — the main button and Enter in both text fields alike.
   * The condition used to hang off the button only: Enter in an empty note
   * field still created an empty marker, and the hint about the first style
   * change stayed away in the process.
   */
  const commit = () => {
    if (!canCommit) return;
    // Saved style changes stay on the page — nothing else says that this is a
    // switch rather than a final state.
    if (changes.length > 0) fire('first-style-change');
    onCommit();
  };

  return (
    <div
      ref={panelRef}
      className={`anno__inspect${dragging ? ' is-dragging' : ''}`}
      style={{ ...placement, borderColor: color }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key !== 'Escape') return;
        // Esc throws open changes away. Without feedback that looks like
        // "saved and closed".
        if (hasEdits) fire('inspect-discarded');
        onClose();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="anno__inspect-top">
        {/* Both prop sets carry `onPointerDown` — the drag wins, and the bubble
            is removed by hand beforehand. Merely spreading them would have
            switched the grip off silently. */}
        <div
          className="anno__inspect-head"
          {...tip('Drag to move')}
          {...headProps}
          onPointerDown={(e) => {
            hideTip();
            headProps.onPointerDown?.(e);
          }}
        >
          {/* Grip dots make it visible that the header drags the popup. */}
          <span className="anno__inspect-grip" aria-hidden="true">
            <IconGrip size={12} />
          </span>
          <span className="anno__inspect-dot" style={{ background: color }} />
          {/* Identity split in two: the tag as a chip, id/class as the title beside it. */}
          <span className="anno__tagchip" title={sel.selector}>
            {sel.tag}
          </span>
          <span className="anno__inspect-title" title={sel.selector}>
            {labelRest}
          </span>
          <span className="anno__inspect-dims">
            {Math.round(sel.w)} × {Math.round(sel.h)}
          </span>
          <button
            type="button"
            className="anno__ibtn"
            {...tip('Close', { keys: 'Esc' })}
            onClick={onClose}
          >
            <IconClose size={15} />
          </button>
        </div>

        {/* Two worlds, two tabs: "Content" for day-to-day work (text + note),
            "Style" for everything technical. The counter on the Style tab gives
            away that changes are pending there, even while it is closed. */}
        <div
          className="anno__tabs"
          role="tablist"
          aria-label="Panel sections"
          onKeyDown={(e) => {
            // Arrow keys switch tabs and take the focus with them (roving
            // tabindex) — with two tabs, left/Home is always Content and
            // right/End always Style.
            let next: 'content' | 'style' | null = null;
            if (e.key === 'ArrowLeft' || e.key === 'Home') next = 'content';
            if (e.key === 'ArrowRight' || e.key === 'End') next = 'style';
            if (!next) return;
            e.preventDefault();
            setTab(next);
            const tabs = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
            tabs[next === 'content' ? 0 : 1]?.focus();
          }}
        >
          <button
            type="button"
            role="tab"
            id="anno-tab-content"
            aria-selected={tab === 'content'}
            aria-controls="anno-panel-content"
            tabIndex={tab === 'content' ? 0 : -1}
            className={`anno__tab${tab === 'content' ? ' is-active' : ''}`}
            onClick={() => setTab('content')}
            {...tip(sel.hasText ? 'Edit text and add a note' : 'Add a note')}
          >
            Content
          </button>
          <button
            type="button"
            role="tab"
            id="anno-tab-style"
            aria-selected={tab === 'style'}
            aria-controls="anno-panel-style"
            tabIndex={tab === 'style' ? 0 : -1}
            className={`anno__tab${tab === 'style' ? ' is-active' : ''}`}
            onClick={() => setTab('style')}
            {...tip('Spacing, font and scope')}
          >
            Style
            {entries.length > 0 && <em className="anno__tab-count">{entries.length}</em>}
          </button>
        </div>
      </div>

      {tab === 'content' && (
        <div
          className="anno__inspect-body"
          role="tabpanel"
          id="anno-panel-content"
          aria-labelledby="anno-tab-content"
        >
          {/* The same switch as in the Style tab: under class scope, the text
              field below writes into *all* matching elements. Anyone typing here
              should see how far that reaches without changing tab. */}
          {sel.hasText && (
            <ScopeControl
              inClass={inClass}
              classSel={classSel}
              classMatches={classMatches}
              onScope={onScope}
            />
          )}

          {/* Whoever clicks a text usually wants to rewrite it — which is why
              the text field sits at the top and gets the focus. */}
          {sel.hasText && (
            <div className="anno__field">
              <div className="anno__field-head">
                <label
                  className="anno__field-label"
                  htmlFor="anno-text-in"
                  {...tipText(`Direct text of <${sel.tag}>`)}
                >
                  Text
                </label>
                {/* The two fields look alike but do different things: one
                    rewrites the page, the other the feedback. Until now that was
                    only in the tooltip — that is to say, nowhere. */}
                <span className="anno__field-hint">
                  {inClass ? `rewrites ${classMatches} elements` : 'rewrites the page'}
                </span>
              </div>
              <textarea
                id="anno-text-in"
                className="anno__text-in"
                // One row as the floor — the height comes from the content
                // (`fitToText`), and an empty box should not reserve three.
                rows={1}
                value={textValue}
                spellCheck={false}
                {...tip('Rewrite the text on the page')}
                // Its own name wins: "Element text" describes the field, the
                // tooltip describes the effect.
                aria-label="Element text"
                ref={(node) => {
                  textRef.current = node;
                  if (!node || focusedFor.current === sel.selector) return;
                  focusedFor.current = sel.selector;
                  // Before the focus: focusing a box still cut to one row would
                  // scroll it, and the cursor would land off-screen.
                  fitToText(node);
                  node.focus();
                  // Cursor to the end rather than selecting everything — a typo
                  // should not overwrite the entire text.
                  const end = node.value.length;
                  node.setSelectionRange(end, end);
                }}
                onChange={(ev) => onText(ev.target.value)}
                onKeyDown={(ev) => {
                  // As in the note field: Enter commits, Shift+Enter wraps.
                  if (ev.key === 'Enter' && !ev.shiftKey) {
                    ev.preventDefault();
                    commit();
                  }
                }}
              />
            </div>
          )}

          {/* Same build as the text field — otherwise the two dark boxes cannot
              be told apart once there is something in them. */}
          <div className="anno__field">
            <div className="anno__field-head">
              <label className="anno__field-label" htmlFor="anno-note-in">
                Note
              </label>
              <span className="anno__field-hint">goes into the feedback</span>
            </div>
            <textarea
              id="anno-note-in"
              className="anno__text-in"
              ref={noteRef}
              value={note}
              spellCheck={false}
              // Two rows as the floor: a note starts empty, and a box that
              // offers room for a sentence invites one. It grows from there.
              rows={2}
              placeholder="What should change here?"
              aria-label="Marker note"
              onChange={(ev) => onNote(ev.target.value)}
              onKeyDown={(ev) => {
                // Enter takes element + note as a marker (Shift+Enter = wrap);
                // Escape falls through to the popup handler and closes.
                if (ev.key === 'Enter' && !ev.shiftKey) {
                  ev.preventDefault();
                  commit();
                }
              }}
            />
          </div>

          {/* Same hint line as in the markers' note popup. */}
          <div className="anno__inspect-keys">Enter saves · Shift+Enter new line · Esc closes</div>
        </div>
      )}

      {tab === 'style' && (
        <div
          className="anno__inspect-body"
          role="tabpanel"
          id="anno-panel-style"
          aria-labelledby="anno-tab-style"
        >
          <ScopeControl
            inClass={inClass}
            classSel={classSel}
            classMatches={classMatches}
            onScope={onScope}
          />

          {/* Font only appears where there is direct text. */}
          {sel.hasText && (
            <div className="anno__inspect-row">
              <span className="anno__inspect-row-label">Font</span>
              <select
                className="anno__inspect-weight"
                value={sel.fontWeight}
                {...tipText(
                  `Weight ${sel.fontWeight}` +
                    (WEIGHT_NAMES[sel.fontWeight] ? ` · ${WEIGHT_NAMES[sel.fontWeight]}` : ''),
                )}
                aria-label="Font weight"
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
                  tip={'Font size · drag to change'}
                  min={1}
                  value={Math.round(sel.fontSize)}
                  onValue={(v) => onStyle('font-size', `${Math.max(1, v)}px`)}
                />
                <span className="anno__inspect-unit">px</span>
              </div>
            </div>
          )}

          {/* In a constrained container, max-width is the actual lever — the
              margins around it are only its result. Both are display-only for
              now, see the note under the table. */}
          {sel.maxWidthRaw != null && (
            <div className="anno__inspect-row">
              <span className="anno__inspect-row-label">Width</span>
              <span className="anno__inspect-prop">max-width</span>
              <span className="anno__inspect-static" {...tipText('Read-only for now')}>
                {sel.maxWidthRaw}
              </span>
            </div>
          )}

          <SpacingBox sel={sel} linked={linked} onToggleLink={onToggleLink} onSpacing={onSpacing} />

          {constrained && (
            <p className="anno__sp-warn">
              <IconWarning size={12} />
              <span>
                This box gets its width from the layout around it
                {hasAutoMargin ? ' and is centred automatically' : ''}. A fixed pixel value here
                would break it on other screen sizes, so{' '}
                {hasAutoMargin ? <b>max-width and auto margins</b> : <b>max-width</b>} can only be
                read for now — editing them is coming in a later update. Padding still works.
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
        </div>
      )}

      <div className="anno__inspect-foot">
        {/* Reset only appears once there is something to take back — otherwise
            the full width belongs to the main action. */}
        {hasEdits && (
          <button
            type="button"
            className="anno__inspect-btn anno__inspect-ghost"
            onClick={onReset}
            {...tip('Revert all edits on this element')}
          >
            <IconUndo size={13} />
            Reset
          </button>
        )}
        <button
          type="button"
          className="anno__inspect-btn anno__inspect-cta"
          disabled={!canCommit}
          onClick={commit}
          {...tip(
            'Saves to feedback — style and text edits stay applied while the marker is visible',
          )}
        >
          <IconPin size={13} />
          {/* The disabled button names the condition instead of promising a
              save that would save nothing — a tooltip would not do, a `disabled`
              button never shows one. */}
          {!canCommit
            ? 'Add a note or an edit'
            : isEditing
              ? 'Update marker'
              : entries.length > 0
                ? `Save ${entries.length} change${entries.length === 1 ? '' : 's'}`
                : 'Add marker'}
        </button>
      </div>
    </div>
  );
}

/**
 * Scope: the whole class or just this element — and below it, in plain words,
 * what that means.
 *
 * It appears in *both* tabs, because both of them write: under class scope the
 * text field replaces the text of every matching element, not just the one
 * clicked. Anyone typing in the Content tab therefore has to see how far that
 * reaches — the match count belongs next to the field, not in another tab.
 */
function ScopeControl({
  inClass,
  classSel,
  classMatches,
  onScope,
}: {
  inClass: boolean;
  classSel: string | null;
  classMatches: number;
  onScope: (scope: 'class' | 'element') => void;
}) {
  const tip = useTip();
  const plural = classMatches === 1 ? '' : 's';
  return (
    <div className="anno__scope">
      <div className="anno__scope-row">
        <span className="anno__inspect-row-label">Apply to</span>
        <div className="anno__seg" role="group" aria-label="Apply changes to">
          <button
            type="button"
            className={inClass ? 'is-active' : ''}
            disabled={!classSel}
            onClick={() => onScope('class')}
            {...tip(classSel ? 'Edit every element with this class' : 'Element has no class')}
          >
            Class
            {/* The number belongs on the button that triggers it — in the
                Content tab it is otherwise the one warning that gets missed. */}
            {classSel && classMatches > 1 && (
              <em className="anno__seg-count">{classMatches}</em>
            )}
          </button>
          <button
            type="button"
            className={!inClass ? 'is-active' : ''}
            onClick={() => onScope('element')}
            {...tip('Edit only this element')}
          >
            This element
          </button>
        </div>
      </div>
      {/* Says in plain words what a change really hits — under class scope, the
          selector and how many elements hang off it. */}
      <span
        className="anno__scope-note"
        title={
          inClass
            ? `${classSel} — ${classMatches} element${plural} on this page`
            : 'Changes apply to this element only'
        }
      >
        {inClass ? (
          <>
            <span className="anno__scope-sel">{classSel}</span>
            <em className="anno__scope-count">
              {' '}
              — affects {classMatches} element{plural} on this page
            </em>
          </>
        ) : classSel ? (
          'Changes apply to this element only'
        ) : (
          'No class — changes apply to this element only'
        )}
      </span>
    </div>
  );
}

/**
 * Spacing as a narrow table: one row per property, columns T/R/B/L, the link
 * button at the end. The colour dot before the name ties the row to the frame
 * in the overlay.
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
  const tipText = useTip();
  const row = (kind: SpacingKind) => (
    <>
      <span className="anno__sp-lab">
        <i className={`anno__sp-dot anno__sp-dot--${kind[0]}`} />
        {kind}
      </span>
      {EDGES.map((edge) => {
        const value = Math.round(sel[kind][EDGE_KEY[edge]]);
        if (kind === 'margin' && sel.autoMargin[EDGE_KEY[edge]]) {
          // Locked rather than a number field: the measured value is only the
          // result of `auto`. Writing it back replaces the centring.
          return (
            <span
              key={edge}
              className="anno__sp-auto"
              {...tipText(`margin-${edge} is auto — currently ${value}px, not editable yet`)}
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
            tip={`${kind}-${edge} · drag to change`}
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
        {...tipText(
          linked[kind]
            ? `${kind}: sides linked — one edit changes all four`
            : `${kind}: link all four sides`,
        )}
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
 * Open changes as chips. The first three always stand there, the rest unfolds
 * — and each can be taken back on its own.
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
  const tipText = useTip();
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
              {...tipText(`Revert ${e.prop}`)}
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
 * Number field with a scrub gesture: a click focuses it (typing), dragging
 * changes the value directly (the Figma/DevTools standard). Shift-drag = steps
 * of ten.
 */
function NumberField({
  className,
  ariaLabel,
  tip,
  min,
  value,
  onValue,
}: {
  className: string;
  ariaLabel: string;
  /** Ready-made tooltip text (contains measurements). */
  tip: string;
  min?: number;
  value: number;
  onValue: (v: number) => void;
}) {
  const scrub = useRef<{ startX: number; startVal: number; moved: boolean; pointerId: number } | null>(
    null,
  );
  const tipProps = useTip()(tip);
  return (
    <input
      className={className}
      type="number"
      step={1}
      min={min}
      // The tooltip props carry an onPointerDown of their own; scrubbing starts
      // at the same place here. Hence merged by hand rather than spread —
      // otherwise one of the two would drop out silently.
      onPointerEnter={tipProps.onPointerEnter}
      onPointerLeave={tipProps.onPointerLeave}
      aria-label={ariaLabel}
      value={value}
      onChange={(ev) => onValue(Number(ev.target.value) || 0)}
      onPointerDown={(e: ReactPointerEvent<HTMLInputElement>) => {
        tipProps.onPointerDown();
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
            /* already released */
          }
        }
        e.preventDefault(); // no text selection while dragging
        const step = e.shiftKey ? 10 : 1;
        onValue(s.startVal + Math.round((dx * 0.5) / step) * step);
      }}
      onPointerUp={(e: ReactPointerEvent<HTMLInputElement>) => {
        const s = scrub.current;
        scrub.current = null;
        if (s?.moved) {
          e.preventDefault();
          e.currentTarget.blur(); // do not keep the focus after the drag
        }
      }}
      onLostPointerCapture={() => {
        scrub.current = null;
      }}
    />
  );
}
