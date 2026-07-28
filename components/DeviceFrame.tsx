import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { viewport, type DeviceInstance } from '@/lib/devices';
import type { Shape, Tool } from '@/lib/annotations';
import { attachTouchScroll } from '@/lib/touchScroll';
import {
  AnnotationOverlay,
  type ElementShapePatch,
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

/** Ab dieser Preset-Breite gilt ein Device als Desktop — darunter Touch. */
const TOUCH_DEFAULT_MAX_WIDTH = 600;
/** Stabile leere Liste — verhindert einen neuen Effekt-Lauf pro Render. */
const EMPTY_SHAPES: Shape[] = [];

/** Karten-Chrom um den Viewport: 2×10px Padding + 2×1px Rahmen. */
const CARD_CHROME = 22;

interface Props {
  device: DeviceInstance;
  src: string;
  zoom: number;
  /** Aendert sich, wenn alle Frames neu geladen werden sollen. */
  reloadKey: number;
  /** Globaler Zeichenmodus — die Overlays aller Frames sind scharf. */
  annotating: boolean;
  /**
   * Die Seite verbietet das Einbetten und der Nutzer arbeitet bewusst ohne
   * Header-Eingriff weiter — statt eines leeren Rahmens steht dann ein
   * Hinweis im Viewport.
   */
  previewBlocked?: boolean;
  shapes: Shape[];
  /** Shape-Ids erledigter Eintraege — gedimmt gerendert. */
  dimmedIds: Set<string>;
  /** Fremde (importierte) Markierungen — nicht verschiebbar. */
  lockedIds?: Set<string>;
  tool: Tool;
  color: string;
  /** Notizen im Overlay einblenden (Screenshot-Export). */
  showNotes: boolean;
  /** Globaler Marker-Schalter (Panel) — pro Device kommt ein eigener dazu. */
  markersVisible: boolean;
  /**
   * Gerade fertiggestellte Markierung bei ausgeblendeten Markern: sie bleibt
   * als einzige stehen und blendet weich aus, statt hart zu verschwinden.
   */
  fadingShapeId?: string | null;
  /**
   * Dieser Frame wird gerade Slice fuer Slice fuer den Screenshot abgescannt:
   * eine Ueberblendung deckt ihn ab, damit niemand mitten hinein scrollt. Sie
   * weicht jeweils nur fuer den Moment der Aufnahme (siehe `veil` in screenshot.ts).
   */
  scanning?: boolean;
  /** Marker, der per Panel-Klick angesprungen wurde (nur dieses Device). */
  flashShapeId: string | null;
  flashNonce: number;
  /** Kurzer Rahmen-Puls des ganzen Devices — zeigt, welches Layout gemeint ist. */
  flashActive: boolean;
  /** Marker, dessen Panel-Eintrag gehovert wird — ruhig hervorheben. */
  hoverShapeId: string | null;
  /** Doppelklick auf einen Marker: Notiz-Editor mit dem Text oeffnen. */
  noteEdit: NoteEditRequest | null;
  /** Dieses Device wird gerade per Drag verschoben. */
  dragging: boolean;
  /**
   * Vollbild-Darstellung: keine Titelleiste, kein Rahmen, kein Drag —
   * nur Frame + Overlay in voller Groesse.
   */
  bare?: boolean;
  onLoad: (device: DeviceInstance, iframe: HTMLIFrameElement) => void;
  onAttach: (device: DeviceInstance, iframe: HTMLIFrameElement | null) => void;
  /** Touch-Modus dieses Frames geaendert (fuer den Hover-Sync). */
  onTouchChange?: (uid: string, touch: boolean) => void;
  onRotate: (uid: string) => void;
  onRemove: (uid: string) => void;
  /**
   * Fokus-Modus dieser Karte: sie steht dann als einzige — mittig — in der
   * Reihe. Fehlt `onToggleFocus` (Vollbild), entfaellt der Knopf.
   */
  focused?: boolean;
  onToggleFocus?: (uid: string) => void;
  /** Klick auf den Feedback-Zaehler: Panel oeffnen und Gruppe hervorheben. */
  onBadgeClick: (presetId: string) => void;
  onAddShape: (uid: string, shape: Shape) => void;
  /** Element-Marker nach erneutem Oeffnen des Popups aktualisiert. */
  onUpdateShape?: (uid: string, shapeId: string, patch: ElementShapePatch) => void;
  /** Markierung ueber den Loesch-Knopf am Marker entfernt (Bestaetigung in App). */
  onDeleteShape?: (shapeId: string) => void;
  /** Gespeicherte CSS-Aenderungen auf die Seite anwenden (Panel-Schalter). */
  applyChanges?: boolean;
  /** Markierung verschoben (Versatz im Dokumentraum). */
  onMoveShape?: (uid: string, shapeId: string, dx: number, dy: number) => void;
  /** Box in der Groesse geaendert (neue Eckpunkte im Dokumentraum). */
  onResizeShape?: (
    uid: string,
    shapeId: string,
    box: { x1: number; y1: number; x2: number; y2: number },
  ) => void;
  /** Abstand eines Linienpaars gesetzt (nur UI-State). */
  onSetLineGap?: (shapeId: string, gap: number | null) => void;
  /** Stand einer Markierung speichern (nach dem Tippen/Ziehen). */
  onCommitShape?: (shapeId: string) => void;
  onSetShapeNote: (uid: string, shapeId: string, note: string) => void;
  /** Drag&Drop-Sortierung: Start, Live-Umsortieren beim Drueberziehen, Ende. */
  onDragBegin: (uid: string) => void;
  /**
   * `side` sagt, ob die gezogene Karte vor oder hinter dieser landen soll —
   * entschieden an der Kartenmitte, damit die Sortierung nicht flackert.
   */
  onDragHover: (uid: string, side: 'before' | 'after') => void;
  onDragEnd: () => void;
}

export function DeviceFrame({
  device,
  src,
  zoom,
  reloadKey,
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
  flashShapeId,
  flashNonce,
  flashActive,
  hoverShapeId,
  noteEdit,
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

  // Lokale Referenz + Load-Zaehler fuer das Annotations-Overlay (Scroll-Tracking).
  const [frameEl, setFrameEl] = useState<HTMLIFrameElement | null>(null);
  const [loadCount, setLoadCount] = useState(0);

  /** Marker nur auf diesem Device ausblenden (Auge in der Titelleiste). */
  const [hidden, setHidden] = useState(false);
  /** Menue der Nebenaktionen (schmale Karten). */
  const [menuOpen, setMenuOpen] = useState(false);

  // Touch-Modus: Mobile-Viewports starten mit Touch (kein Hover, Ziehen
  // scrollt) — per Button in der Titelleiste umschaltbar.
  const [touch, setTouch] = useState(!bare && device.width < TOUCH_DEFAULT_MAX_WIDTH);

  /**
   * Full-Page-Modus: der Frame wird so hoch wie die Seite, statt in
   * Device-Hoehe zu scrollen — die ganze Seite steht am Stueck im Bild.
   *
   * Achtung, das ist keine reine Darstellungsfrage: mit dem Frame waechst
   * auch `innerHeight` *in* der Seite. `100vh`-Bloecke, Sticky-Header und
   * Lazy-Loading verhalten sich dann anders als auf dem echten Geraet. Genau
   * darum zeichnet der Modus den Viewport ein, der wirklich greifen wuerde
   * (siehe Falz-Markierung unten).
   */
  const [fullPage, setFullPage] = useState(false);
  /**
   * Waehrend des Screenshots gilt wieder die Geraetehoehe: der Export
   * fotografiert den sichtbaren Tab-Ausschnitt und scrollt dafuer *in* der
   * Seite. Ein seitenhoher Frame passt nicht auf den Schirm — das Bild waere
   * unten abgeschnitten. Der Knopf bleibt an, die Ansicht kommt danach zurueck.
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
        /* Frame nicht lesbar — dann bleibt es bei der Device-Hoehe */
      }
    };
    measure();
    // Die Seite waechst und schrumpft im Betrieb (Bilder, Lazy-Load,
    // aufgeklappte Bereiche) — sonst bliebe unten ein leerer Streifen oder
    // die Seite waere abgeschnitten.
    let observer: ResizeObserver | null = null;
    try {
      const doc = frameEl.contentDocument;
      // Der ResizeObserver der Seite selbst, damit er im richtigen Realm
      // haengt; ohne lesbaren Frame greift der eigene.
      const win = frameEl.contentWindow as (Window & typeof globalThis) | null;
      const Observer = win?.ResizeObserver ?? window.ResizeObserver;
      if (doc?.documentElement && Observer) {
        const ro = new Observer(measure);
        ro.observe(doc.documentElement);
        if (doc.body) ro.observe(doc.body);
        observer = ro;
      }
    } catch {
      /* Frame nicht lesbar */
    }
    return () => observer?.disconnect();
  }, [fullPageNow, frameEl, loadCount, height]);

  /** Hoehe des Frames: im Full-Page-Modus die der Seite, sonst die des Geraets. */
  const frameHeight = fullPageNow && pageHeight ? pageHeight : height;

  // Drag-Scroll an den Frame haengen; nach jedem Load haengt er am frischen
  // Dokument neu. Der Hover-Sync erfaehrt den Modus ueber onTouchChange.
  const onTouchChangeRef = useRef(onTouchChange);
  onTouchChangeRef.current = onTouchChange;
  useEffect(() => {
    onTouchChangeRef.current?.(device.uid, touch);
    if (!touch || !frameEl) return;
    const detach = attachTouchScroll(frameEl);
    return () => detach?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touch, frameEl, loadCount, device.uid]);

  // Drag&Drop nur ueber die Titelleiste: `draggable` wird erst scharf, wenn
  // die Leiste (nicht ihre Buttons) gedrueckt ist — sonst wuerde jeder
  // Zeichenstrich auf dem Overlay einen Karten-Drag starten.
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

  // Beim Anspringen aus dem Panel Marker trotz Ausblendung zeigen — sonst
  // pulst der Flash ins Leere.
  const markersOn = (markersVisible && !hidden) || flashShapeId != null;
  // Bei ausgeblendeten Markern bleibt die frisch gezeichnete als einzige
  // stehen, bis sie ausgeblendet ist. Das Auge dieser Karte hat Vorrang:
  // wer sie hier stumm geschaltet hat, will auch das nicht sehen.
  const visibleShapes = markersOn
    ? shapes
    : hidden
      ? []
      : shapes.filter((s) => s.id === fadingShapeId);

  // Der Ref-Callback MUSS eine stabile Identitaet haben: React ruft einen
  // geaenderten Callback bei jedem Re-Render erst mit null, dann mit dem
  // Element auf — der null-Aufruf haengt in App die Sync-Listener ab, ohne
  // dass ein neues load-Event sie je wieder anhaengen wuerde.
  const deviceRef = useRef(device);
  deviceRef.current = device;
  const onAttachRef = useRef(onAttach);
  onAttachRef.current = onAttach;
  const attachRef = useCallback((el: HTMLIFrameElement | null) => {
    setFrameEl(el);
    onAttachRef.current(deviceRef.current, el);
  }, []);

  /**
   * Nebenaktionen der Titelleiste. Auf breiten Karten stehen sie als Icons in
   * der Reihe; wird die Karte schmal (Handy-Viewports), wandern dieselben
   * Aktionen hinter das Menue rechts. Vorher fielen sie bei zu wenig Platz
   * einfach weg und waren gar nicht mehr erreichbar.
   */
  const barActions: ReadonlyArray<{
    key: string;
    cls: string;
    on: boolean;
    icon: JSX.Element;
    label: string;
    title: string;
    run: () => void;
  }> = [
    {
      key: 'touch',
      cls: 'device__touch',
      on: touch,
      icon: <IconTouch size={14} />,
      label: 'Touch mode',
      title: touch
        ? 'Touch mode on — drag scrolls, no hover. Click for mouse mode.'
        : 'Mouse mode — click for touch mode (drag scrolls, no hover).',
      run: () => setTouch((v) => !v),
    },
    ...(shapes.length > 0 || hidden
      ? [
          {
            key: 'eye',
            cls: 'device__eye',
            on: hidden,
            icon: hidden ? <IconEyeOff size={14} /> : <IconEye size={14} />,
            label: 'Hide markings',
            title: hidden ? 'Show markings on this device' : 'Hide markings on this device',
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
            title: focused
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
      title: fullPage
        ? 'Full page on — the frame is as tall as the page; the marked box is the real viewport'
        : 'Full page — show the whole page at once, with the real viewport marked',
      run: () => setFullPage((v) => !v),
    },
    {
      key: 'rotate',
      cls: 'device__rotate',
      on: false,
      icon: <IconRotateDevice size={14} />,
      label: 'Rotate',
      title: 'Rotate orientation (portrait/landscape)',
      run: () => onRotate(device.uid),
    },
  ];

  return (
    <div
      className={`device${annotating ? ' device--annotating' : ''}${flashActive ? ' device--flash' : ''}${dragging ? ' device--dragging' : ''}${bare ? ' device--bare' : ''}${focused ? ' device--focused' : ''}`}
      data-uid={device.uid}
      // Feste Kartenbreite aus dem Viewport: sonst wuerde eine breite
      // Titelleiste (viele Buttons) die Karte aufblaehen und die vom
      // zeilenfuellenden Layout gepackte Zeile doch umbrechen lassen.
      style={bare ? undefined : { width: Math.round(width * zoom) + CARD_CHROME }}
      draggable={!bare && dragArmed}
      onDragStart={(e) => {
        // Synthetische Events (Tests) haben kein dataTransfer.
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
        // Vor oder hinter dieser Karte? An der Kartenmitte entschieden —
        // stumpfes "an den Ziel-Index" wuerde an den Raendern hin- und
        // herspringen (Karte weicht aus, Maus steht wieder ueber ihr, ...).
        const rect = e.currentTarget.getBoundingClientRect();
        onDragHover(device.uid, e.clientX < rect.left + rect.width / 2 ? 'before' : 'after');
      }}
      onDrop={(e) => e.preventDefault()}
      // Das Menue lebt in der Karte: verlaesst der Zeiger sie, ist es erledigt.
      // Spart einen Klickfaenger, den die Container-Eindaemmung der Karte
      // ohnehin auf ihre eigene Flaeche beschraenken wuerde.
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
            title="Show this device's feedback in the panel"
            onClick={() => onBadgeClick(device.id)}
          >
            {shapes.length}
          </button>
        )}
        <span className="device__bar-spacer" />
        {/* Breite Karten: die Nebenaktionen stehen in der Reihe. */}
        <span className="device__acts">
          {barActions.map((a) => (
            <button
              key={a.key}
              className={`icon-btn icon-btn--small ${a.cls}${a.on ? ' icon-btn--active' : ''}`}
              onClick={a.run}
              aria-pressed={a.on}
              title={a.title}
            >
              {a.icon}
            </button>
          ))}
        </span>
        {/* Schmale Karten: dieselben Aktionen hinter einem Menue. */}
        <button
          className={`icon-btn icon-btn--small device__more${menuOpen ? ' icon-btn--active' : ''}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-haspopup="true"
          title="More device options"
        >
          <IconDots size={14} />
        </button>
        <button
          className="icon-btn icon-btn--small icon-btn--danger"
          onClick={() => onRemove(device.uid)}
          title="Remove"
        >
          <IconClose size={14} />
        </button>
      </div>
      )}

      {/* Ausserhalb der Titelleiste: die haelt `overflow: hidden`, ein Menue
          darin waere abgeschnitten. */}
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
          // Der key erzwingt beim Reload einen frischen Frame statt eines
          // src-Wechsels — sonst bleibt eine blockierte Fehlerseite stehen.
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

        {/* Falz-Markierung: der Kasten ist der Viewport, der auf dem echten
            Geraet greifen wuerde; darunter beginnt below the fold. Rein
            dekorativ — Klicks und Zeichnen gehen hindurch. */}
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
          Im Vollbild fuellt der Frame das ganze Fenster — es gibt kein
          „ausserhalb", in das die Anzeige ausweichen koennte. Nur dort liegt
          sie im Bild und muss fuer jede Aufnahme weichen. In der Device-
          Ansicht uebernimmt das die Abdunklung *um* die Karte herum
          (`shot-spot` in App.tsx), die durchgehend stehen bleibt.
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
          // Volle Liste (auch bei ausgeblendeten Markern): die CSS-Aenderungen
          // bleiben angewendet, nur die roten Rahmen verschwinden. Leer, wenn
          // der Panel-Schalter die Auswirkungen abschaltet (Vergleich Original).
          styleShapes={applyChanges ? shapes : EMPTY_SHAPES}
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
          frameEl={frameEl}
          loadCount={loadCount}
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
