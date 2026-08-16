import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { viewport, type DeviceInstance } from '@/lib/devices';
import type { Shape, Tool } from '@/lib/annotations';
import { attachTouchScroll } from '@/lib/touchScroll';
import { motionOk } from '@/lib/motion';
import { useFireHint } from '@/lib/hints';
import { useTip } from './Tooltip';
import {
  AnnotationOverlay,
  type ElementShapePatch,
  type ElementPickRequest,
  type NoteEditRequest,
} from './AnnotationOverlay';
import { deviceIcon } from './Toolbar';
import {
  IconCheck,
  IconClose,
  IconDots,
  IconEye,
  IconEyeOff,
  IconFocus,
  IconFullPage,
  IconRotateDevice,
  IconTouch,
} from './icons';

/** From this preset width up, a device counts as desktop — below it, touch. */
const TOUCH_DEFAULT_MAX_WIDTH = 600;
/** A stable empty list — stops a fresh effect run on every render. */
const EMPTY_SHAPES: Shape[] = [];

/** Id of the style inserted into the preview frames that cuts the scrollbars. */
const HIDE_SCROLLBARS_ID = 'ink-hide-scrollbars';

/** Card chrome around the viewport: 2×10px padding + 2×1px border. */
const CARD_CHROME = 22;

interface Props {
  device: DeviceInstance;
  src: string;
  zoom: number;
  /** Changes when all frames should be reloaded. */
  reloadKey: number;
  /** Counts every unfold — the overlay then remeasures. */
  revealNonce?: number;
  /** Global draw mode — the overlays of all frames are armed. */
  annotating: boolean;
  /**
   * The page forbids embedding and the user deliberately carries on without
   * the header change — instead of an empty frame, a notice then stands in the
   * viewport.
   */
  previewBlocked?: boolean;
  shapes: Shape[];
  /** Shape ids of completed entries — rendered dimmed. */
  dimmedIds: Set<string>;
  /** Foreign (imported) markings — not movable. */
  lockedIds?: Set<string>;
  tool: Tool;
  color: string;
  /** Show notes in the overlay (screenshot export). */
  showNotes: boolean;
  /** Global marker switch (panel) — each device adds one of its own. */
  markersVisible: boolean;
  /**
   * A marking just finished while markers are hidden: it alone stays and fades
   * out softly, instead of vanishing abruptly.
   */
  fadingShapeId?: string | null;
  /**
   * This frame is currently being scanned slice by slice for the screenshot: an
   * overlay covers it so nobody scrolls into the middle of it. It gives way
   * only for the moment of each shot (see `veil` in screenshot.ts).
   */
  scanning?: boolean;
  /**
   * The frame is not yet standing at the position taken over from the page (see
   * `watchSeed` in App.tsx) — it stays covered until it is. Without that, the
   * user watches the page load at the top and then jump, which is exactly what
   * the takeover is there to spare them.
   */
  settling?: boolean;
  /** Marker jumped to from the panel (this device only). */
  flashShapeId: string | null;
  flashNonce: number;
  /** A short frame pulse of the whole device — shows which layout is meant. */
  flashActive: boolean;
  /** Marker whose panel entry is hovered — highlight it quietly. */
  hoverShapeId: string | null;
  /** Double-click on a marker: open the note editor with its text. */
  noteEdit: NoteEditRequest | null;
  /** Right-click in the preview: pin the element under the cursor + popup. */
  elementPick: ElementPickRequest | null;
  /** This device is currently being dragged. */
  dragging: boolean;
  /**
   * Full-window rendering: no title bar, no frame, no dragging — just frame
   * plus overlay at full size.
   */
  bare?: boolean;
  onLoad: (device: DeviceInstance, iframe: HTMLIFrameElement) => void;
  onAttach: (device: DeviceInstance, iframe: HTMLIFrameElement | null) => void;
  /** This frame's touch mode changed (for the hover sync). */
  onTouchChange?: (uid: string, touch: boolean) => void;
  onRotate: (uid: string) => void;
  onRemove: (uid: string) => void;
  /**
   * Focus mode for this card: it then stands alone — centred — in the row. If
   * `onToggleFocus` is missing (full window), the button is dropped.
   */
  focused?: boolean;
  onToggleFocus?: (uid: string) => void;
  /** Click on the feedback counter: open the panel and highlight the group. */
  onBadgeClick: (presetId: string) => void;
  onAddShape: (uid: string, shape: Shape) => void;
  /** Element marker updated after reopening the popup. */
  onUpdateShape?: (uid: string, shapeId: string, patch: ElementShapePatch) => void;
  /** Marking removed via the delete button on the marker (confirmed in App). */
  onDeleteShape?: (shapeId: string) => void;
  /** Apply the saved CSS changes to the page (panel switch). */
  applyChanges?: boolean;
  /** Marking moved (offset in document space). */
  onMoveShape?: (uid: string, shapeId: string, dx: number, dy: number) => void;
  /** Box resized (new corner points in document space). */
  onResizeShape?: (
    uid: string,
    shapeId: string,
    box: { x1: number; y1: number; x2: number; y2: number },
  ) => void;
  /** Distance of a line pair set (UI state only). */
  onSetLineGap?: (shapeId: string, gap: number | null) => void;
  /** Save a marking's state (after typing or dragging). */
  onCommitShape?: (shapeId: string) => void;
  onSetShapeNote: (uid: string, shapeId: string, note: string) => void;
  /** Drag-and-drop ordering: start, live reorder while dragging over, end. */
  onDragBegin: (uid: string) => void;
  /**
   * `side` says whether the dragged card should land before or after this one —
   * decided at the card's centre, so the ordering does not flicker.
   */
  onDragHover: (uid: string, side: 'before' | 'after') => void;
  onDragEnd: () => void;
}

/**
 * How long the cover takes to fade out — must match `.device__settle--gone` in
 * styles.ts. Unhurried on purpose: the frame appearing is the moment the whole
 * takeover is for, and a hard cut makes it look like a glitch.
 */
const SETTLE_FADE_MS = 420;
/**
 * How long the wait has to last before the cover says anything. On a page that
 * is there in 150 ms the line would only flash past — an explanation nobody can
 * read is worse than a sheet that is quietly gone again.
 */
const SETTLE_TEXT_MS = 350;

export function DeviceFrame({
  device,
  src,
  zoom,
  reloadKey,
  revealNonce = 0,
  annotating,
  previewBlocked = false,
  shapes,
  dimmedIds,
  lockedIds,
  tool,
  color,
  showNotes,
  markersVisible,
  fadingShapeId,
  scanning = false,
  settling = false,
  flashShapeId,
  flashNonce,
  flashActive,
  hoverShapeId,
  noteEdit,
  elementPick,
  dragging,
  bare = false,
  onLoad,
  onAttach,
  onTouchChange,
  onRotate,
  onRemove,
  focused = false,
  onToggleFocus,
  onBadgeClick,
  onAddShape,
  onUpdateShape,
  onDeleteShape,
  applyChanges = true,
  onMoveShape,
  onResizeShape,
  onSetLineGap,
  onCommitShape,
  onSetShapeNote,
  onDragBegin,
  onDragHover,
  onDragEnd,
}: Props) {
  const { width, height } = viewport(device);

  // Local reference plus load counter for the annotation overlay (scroll tracking).
  const [frameEl, setFrameEl] = useState<HTMLIFrameElement | null>(null);
  const [loadCount, setLoadCount] = useState(0);

  /**
   * The cover over a frame that is still finding its position outlives the
   * `settling` flag: it fades out rather than disappearing, and for that it has
   * to stay in the tree for the length of the fade. Without motion it goes
   * immediately — there is nothing to see there then anyway.
   */
  const [settleShown, setSettleShown] = useState(settling);
  useEffect(() => {
    if (settling) {
      setSettleShown(true);
      return;
    }
    if (!settleShown) return;
    if (!motionOk()) {
      setSettleShown(false);
      return;
    }
    const t = window.setTimeout(() => setSettleShown(false), SETTLE_FADE_MS);
    return () => window.clearTimeout(t);
  }, [settling, settleShown]);

  /** Says what it is waiting for — only once the wait is worth a word. */
  const [settleWordy, setSettleWordy] = useState(false);
  useEffect(() => {
    if (!settling) return; // while fading out, the line stays as it is
    setSettleWordy(false);
    const t = window.setTimeout(() => setSettleWordy(true), SETTLE_TEXT_MS);
    return () => window.clearTimeout(t);
  }, [settling]);

  /** Hide markers on this device only (the eye in the title bar). */
  const [hidden, setHidden] = useState(false);
  /** Menu of the secondary actions (narrow cards). */
  const [menuOpen, setMenuOpen] = useState(false);

  // Touch mode: mobile viewports start with touch (no hover, dragging scrolls)
  // — switchable via the button in the title bar.
  const [touch, setTouch] = useState(!bare && device.width < TOUCH_DEFAULT_MAX_WIDTH);
  const fire = useFireHint();
  const tip = useTip();

  /**
   * Full-page mode: the frame grows as tall as the page instead of scrolling at
   * device height — the whole page stands in the picture in one piece.
   *
   * Careful, this is not purely a display question: `innerHeight` *inside* the
   * page grows with the frame. `100vh` blocks, sticky headers and lazy loading
   * then behave differently from the real device. Which is exactly why the mode
   * draws in the viewport that would really apply (see the fold marking below).
   */
  const [fullPage, setFullPage] = useState(false);
  /**
   * During the screenshot the device height applies again: the export
   * photographs the visible part of the tab and scrolls *inside* the page for
   * it. A page-tall frame does not fit on the screen — the image would be cut
   * off at the bottom. The button stays on, the view comes back afterwards.
   */
  const fullPageNow = fullPage && !scanning;
  const [pageHeight, setPageHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!fullPageNow || !frameEl) {
      setPageHeight(null);
      return;
    }
    const measure = () => {
      try {
        const doc = frameEl.contentDocument;
        const el = doc?.scrollingElement ?? doc?.documentElement;
        if (el) setPageHeight(Math.max(height, Math.ceil(el.scrollHeight)));
      } catch {
        /* frame not readable — the device height then stands */
      }
    };
    measure();
    // The page grows and shrinks while running (images, lazy loading, unfolded
    // sections) — otherwise an empty strip would be left at the bottom, or the
    // page would be cut off.
    let observer: ResizeObserver | null = null;
    try {
      const doc = frameEl.contentDocument;
      // The page's own ResizeObserver, so that it hangs in the right realm;
      // without a readable frame, ours applies.
      const win = frameEl.contentWindow as (Window & typeof globalThis) | null;
      const Observer = win?.ResizeObserver ?? window.ResizeObserver;
      if (doc?.documentElement && Observer) {
        const ro = new Observer(measure);
        ro.observe(doc.documentElement);
        if (doc.body) ro.observe(doc.body);
        observer = ro;
      }
    } catch {
      /* frame not readable */
    }
    return () => observer?.disconnect();
  }, [fullPageNow, frameEl, loadCount, height]);

  /** Height of the frame: the page's in full-page mode, otherwise the device's. */
  const frameHeight = fullPageNow && pageHeight ? pageHeight : height;

  // The preview should show the page, not the iframe's scrollbars. Scaled down
  // they are only noise, and inside the phone frame several of them stood on
  // top of each other (the document plus the page's own scrolling areas).
  // Scrolling still works — just invisibly, as on the device.
  useEffect(() => {
    if (!frameEl) return;
    try {
      const doc = frameEl.contentDocument;
      const head = doc?.head;
      if (!head || doc.getElementById(HIDE_SCROLLBARS_ID)) return;
      const style = doc.createElement('style');
      style.id = HIDE_SCROLLBARS_ID;
      style.textContent =
        '*{scrollbar-width:none!important}' +
        '*::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}';
      head.append(style);
    } catch {
      /* frame not readable (foreign origin) */
    }
  }, [frameEl, loadCount]);

  // Attach drag-scroll to the frame; after every load it reattaches to the
  // fresh document. The hover sync learns the mode via onTouchChange.
  const onTouchChangeRef = useRef(onTouchChange);
  onTouchChangeRef.current = onTouchChange;
  useEffect(() => {
    onTouchChangeRef.current?.(device.uid, touch);
    if (!touch || !frameEl) return;
    const detach = attachTouchScroll(frameEl);
    return () => detach?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touch, frameEl, loadCount, device.uid]);

  // Drag and drop only via the title bar: `draggable` is only armed once the
  // bar (not its buttons) is pressed — otherwise every pen stroke on the
  // overlay would start a card drag.
  const [dragArmed, setDragArmed] = useState(false);
  useEffect(() => {
    if (!dragArmed) return;
    const disarm = () => setDragArmed(false);
    window.addEventListener('pointerup', disarm, true);
    window.addEventListener('dragend', disarm, true);
    return () => {
      window.removeEventListener('pointerup', disarm, true);
      window.removeEventListener('dragend', disarm, true);
    };
  }, [dragArmed]);

  // When jumping in from the panel, show markers despite them being hidden —
  // otherwise the flash pulses into nothing.
  const markersOn = (markersVisible && !hidden) || flashShapeId != null;
  // While markers are hidden, the freshly drawn one alone stays until it has
  // faded out. This card's eye takes precedence: whoever silenced it here does
  // not want to see that either.
  const visibleShapes = markersOn
    ? shapes
    : hidden
      ? []
      : shapes.filter((s) => s.id === fadingShapeId);

  // The ref callback MUST have a stable identity: React calls a changed
  // callback on every re-render first with null and then with the element — and
  // the null call detaches the sync listeners in App, without any new load
  // event ever reattaching them.
  const deviceRef = useRef(device);
  deviceRef.current = device;
  const onAttachRef = useRef(onAttach);
  onAttachRef.current = onAttach;
  const attachRef = useCallback((el: HTMLIFrameElement | null) => {
    setFrameEl(el);
    onAttachRef.current(deviceRef.current, el);
  }, []);

  /**
   * Secondary actions of the title bar. On wide cards they stand as icons in
   * the row; once the card gets narrow (phone viewports) the same actions move
   * behind the menu on the right. Previously they simply fell away when space
   * ran short and could not be reached at all.
   */
  const barActions: ReadonlyArray<{
    key: string;
    cls: string;
    on: boolean;
    icon: JSX.Element;
    label: string;
    tip: string;
    run: () => void;
  }> = [
    {
      key: 'touch',
      cls: 'device__touch',
      on: touch,
      icon: <IconTouch size={14} />,
      label: 'Touch mode',
      tip: touch
        ? 'Touch mode on — drag scrolls, no hover'
        : 'Mouse mode — click for touch mode',
      run: () => {
        // That dragging now scrolls instead of hovering changes how the card is
        // used from the ground up, without the card showing it.
        if (!touch) fire('first-touch-device');
        setTouch((v) => !v);
      },
    },
    ...(shapes.length > 0 || hidden
      ? [
          {
            key: 'eye',
            cls: 'device__eye',
            on: hidden,
            icon: hidden ? <IconEyeOff size={14} /> : <IconEye size={14} />,
            label: 'Hide markings',
            tip: hidden
              ? 'Show markings on this device'
              : 'Hide markings on this device',
            run: () => setHidden((v) => !v),
          },
        ]
      : []),
    ...(onToggleFocus
      ? [
          {
            key: 'focus',
            cls: 'device__focus',
            on: focused,
            icon: <IconFocus size={14} />,
            label: 'Focus',
            tip: focused
              ? 'Leave focus — show all devices again'
              : 'Focus — show only this device, centred',
            run: () => onToggleFocus(device.uid),
          },
        ]
      : []),
    {
      key: 'fullpage',
      cls: 'device__fullpage',
      on: fullPage,
      icon: <IconFullPage size={14} />,
      label: 'Full page',
      tip: fullPage
        ? 'Full page on — the marked box is the real viewport'
        : 'Full page — show the whole page at once',
      run: () => setFullPage((v) => !v),
    },
    {
      key: 'rotate',
      cls: 'device__rotate',
      on: false,
      icon: <IconRotateDevice size={14} />,
      label: 'Rotate',
      tip: 'Rotate orientation (portrait/landscape)',
      run: () => onRotate(device.uid),
    },
  ];

  return (
    <div
      className={`device${annotating ? ' device--annotating' : ''}${flashActive ? ' device--flash' : ''}${dragging ? ' device--dragging' : ''}${bare ? ' device--bare' : ''}${focused ? ' device--focused' : ''}`}
      data-uid={device.uid}
      // Fixed card width from the viewport: otherwise a wide title bar (many
      // buttons) would inflate the card and make the row that the row-filling
      // layout had packed wrap after all.
      style={bare ? undefined : { width: Math.round(width * zoom) + CARD_CHROME }}
      draggable={!bare && dragArmed}
      onDragStart={(e) => {
        // Synthetic events (tests) have no dataTransfer.
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', device.uid);
        }
        onDragBegin(device.uid);
      }}
      onDragEnd={() => {
        setDragArmed(false);
        onDragEnd();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        // Before or after this card? Decided at the card's centre — a blunt "to
        // the target index" would jump back and forth at the edges (the card
        // moves aside, the mouse is over it again, and so on).
        const rect = e.currentTarget.getBoundingClientRect();
        onDragHover(device.uid, e.clientX < rect.left + rect.width / 2 ? 'before' : 'after');
      }}
      onDrop={(e) => e.preventDefault()}
      // The menu lives in the card: once the pointer leaves it, it is done.
      // Saves a click catcher that the card's containment would restrict to its
      // own area anyway.
      onPointerLeave={() => setMenuOpen(false)}
    >
      {!bare && (
      <div
        className="device__bar"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          setDragArmed(true);
        }}
      >
        <span className="device__icon">{deviceIcon(width, 15)}</span>
        <span className="device__name">{device.name}</span>
        <span className="device__size">
          {width}×{height}
        </span>
        {shapes.length > 0 && (
          <button
            className="device__anno-count"
            {...tip('Show this device’s feedback in the panel')}
            onClick={() => onBadgeClick(device.id)}
          >
            {shapes.length}
          </button>
        )}
        <span className="device__bar-spacer" />
        {/* Wide cards: the secondary actions stand in the row. */}
        <span className="device__acts">
          {barActions.map((a) => (
            <button
              key={a.key}
              className={`icon-btn icon-btn--small ${a.cls}${a.on ? ' icon-btn--active' : ''}`}
              onClick={a.run}
              aria-pressed={a.on}
              {...tip(a.tip)}
            >
              {a.icon}
            </button>
          ))}
        </span>
        {/* Narrow cards: the same actions behind a menu. */}
        <button
          className={`icon-btn icon-btn--small device__more${menuOpen ? ' icon-btn--active' : ''}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-haspopup="true"
          {...tip('More device options')}
        >
          <IconDots size={14} />
        </button>
        <button
          className="icon-btn icon-btn--small icon-btn--danger"
          onClick={() => onRemove(device.uid)}
          {...tip('Remove this viewport')}
        >
          <IconClose size={14} />
        </button>
      </div>
      )}

      {/* Outside the title bar: that keeps `overflow: hidden`, so a menu inside
          it would be cut off. */}
      {!bare && menuOpen && (
        <div className="menu device__menu" role="menu">
          {barActions.map((a) => (
            <button
              key={a.key}
              className="menu__item"
              role="menuitemcheckbox"
              aria-checked={a.on}
              onClick={() => {
                a.run();
                setMenuOpen(false);
              }}
            >
              <span className="menu__item-icon">{a.icon}</span>
              <span className="menu__item-name">{a.label}</span>
              <span className="menu__check">{a.on && <IconCheck size={14} />}</span>
            </button>
          ))}
        </div>
      )}

      <div
        className={`device__viewport${fullPageNow ? ' device__viewport--full' : ''}`}
        style={{
          width: Math.round(width * zoom),
          height: Math.round(frameHeight * zoom),
        }}
      >
        <iframe
          // On reload the key forces a fresh frame rather than a src change —
          // otherwise a blocked error page stays put.
          key={`${reloadKey}:${src}`}
          ref={attachRef}
          src={src}
          width={width}
          height={frameHeight}
          style={{ transform: `scale(${zoom})` }}
          onLoad={(e) => {
            setLoadCount((c) => c + 1);
            onLoad(device, e.currentTarget);
          }}
        />

        {/* Covers the frame until it stands at the position taken over from the
            page, then fades away and lets it through. A quiet sheet with one
            line rather than a spinner: what is happening is not a load anyone
            has to watch, and the line says why the frame is not simply starting
            at the top. Under a card width of ~190 px the line is dropped: it
            does not scale with the frame, and in a narrow card it would break
            into three lines instead of saying something. */}
        {settleShown && (
          <div
            className={`device__settle${settling ? '' : ' device__settle--gone'}`}
            aria-hidden="true"
          >
            {settleWordy && Math.round(width * zoom) >= 190 && (
              <span>Picking up where you were…</span>
            )}
          </div>
        )}

        {/* Fold marking: the box is the viewport that would apply on the real
            device; below it, below the fold begins. Purely decorative — clicks
            and drawing pass straight through. */}
        {fullPageNow && (
          <>
            <div className="fold" style={{ height: Math.round(height * zoom) }}>
              <span className="fold__tag">
                Viewport {width}×{height}
              </span>
              <span className="fold__tag fold__tag--line">above the fold</span>
            </div>
            <div className="fold-rest" style={{ top: Math.round(height * zoom) }}>
              <span className="fold__tag fold__tag--rest">below the fold</span>
            </div>
          </>
        )}

        {/*
          In full window mode the frame fills the whole window — there is no
          "outside" for the indicator to move to. Only there does it sit in the
          picture and have to give way for every shot. In the device view the
          dimming *around* the card takes over (`shot-spot` in App.tsx), which
          stays put throughout.
        */}
        {scanning && bare && (
          <div className="shot-badge shot-badge--inside">
            <span className="shot-badge__spinner" />
            <span>Capturing full page… please don’t scroll</span>
          </div>
        )}

        {previewBlocked && (
          <div className="device__blocked">
            <strong>Preview blocked by the site</strong>
            <p>
              This page sends headers that forbid embedding. Turn the preview on from the toolbar
              marker whenever you want.
            </p>
          </div>
        )}

        <AnnotationOverlay
          width={width}
          height={frameHeight}
          zoom={zoom}
          active={annotating}
          shapes={visibleShapes}
          // The full list (even with markers hidden): the CSS changes stay
          // applied, only the red frames disappear. Empty when the panel switch
          // turns the effects off (comparing against the original).
          styleShapes={applyChanges ? shapes : EMPTY_SHAPES}
          stylesApplied={applyChanges}
          dimmedIds={dimmedIds}
          lockedIds={lockedIds}
          tool={tool}
          color={color}
          showNotes={showNotes}
          flashShapeId={flashShapeId}
          flashNonce={flashNonce}
          fadingShapeId={markersOn ? null : fadingShapeId}
          hoverShapeId={hoverShapeId}
          editRequest={noteEdit}
          pickRequest={elementPick}
          frameEl={frameEl}
          loadCount={loadCount}
          revealNonce={revealNonce}
          onAdd={(shape) => onAddShape(device.uid, shape)}
          onSetNote={(shapeId, note) => onSetShapeNote(device.uid, shapeId, note)}
          onUpdateShape={
            onUpdateShape && ((shapeId, patch) => onUpdateShape(device.uid, shapeId, patch))
          }
          onDeleteShape={onDeleteShape}
          onMoveShape={
            onMoveShape && ((shapeId, dx, dy) => onMoveShape(device.uid, shapeId, dx, dy))
          }
          onResizeShape={
            onResizeShape && ((shapeId, box) => onResizeShape(device.uid, shapeId, box))
          }
          onSetLineGap={onSetLineGap}
          onCommitShape={onCommitShape}
        />
      </div>
    </div>
  );
}
