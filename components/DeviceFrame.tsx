import { useCallback, useEffect, useRef, useState } from 'react';
import { viewport, type DeviceInstance } from '@/lib/devices';
import type { Shape, Tool } from '@/lib/annotations';
import { attachTouchScroll } from '@/lib/touchScroll';
import { AnnotationOverlay, type NoteEditRequest } from './AnnotationOverlay';
import { deviceIcon } from './Toolbar';
import { IconClose, IconEye, IconEyeOff, IconRotateDevice, IconTouch } from './icons';

/** Ab dieser Preset-Breite gilt ein Device als Desktop — darunter Touch. */
const TOUCH_DEFAULT_MAX_WIDTH = 600;

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
  shapes: Shape[];
  /** Shape-Ids erledigter Eintraege — gedimmt gerendert. */
  dimmedIds: Set<string>;
  tool: Tool;
  color: string;
  /** Notizen im Overlay einblenden (Screenshot-Export). */
  showNotes: boolean;
  /** Globaler Marker-Schalter (Panel) — pro Device kommt ein eigener dazu. */
  markersVisible: boolean;
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
  /** Klick auf den Feedback-Zaehler: Panel oeffnen und Gruppe hervorheben. */
  onBadgeClick: (presetId: string) => void;
  onAddShape: (uid: string, shape: Shape) => void;
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
  shapes,
  dimmedIds,
  tool,
  color,
  showNotes,
  markersVisible,
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
  onBadgeClick,
  onAddShape,
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

  // Touch-Modus: Mobile-Viewports starten mit Touch (kein Hover, Ziehen
  // scrollt) — per Button in der Titelleiste umschaltbar.
  const [touch, setTouch] = useState(!bare && device.width < TOUCH_DEFAULT_MAX_WIDTH);

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
  const visibleShapes = markersOn ? shapes : [];

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

  return (
    <div
      className={`device${annotating ? ' device--annotating' : ''}${flashActive ? ' device--flash' : ''}${dragging ? ' device--dragging' : ''}${bare ? ' device--bare' : ''}`}
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
        <button
          className={`icon-btn icon-btn--small device__touch${touch ? ' icon-btn--active' : ''}`}
          onClick={() => setTouch((v) => !v)}
          aria-pressed={touch}
          title={
            touch
              ? 'Touch mode on — drag scrolls, no hover. Click for mouse mode.'
              : 'Mouse mode — click for touch mode (drag scrolls, no hover).'
          }
        >
          <IconTouch size={14} />
        </button>
        {(shapes.length > 0 || hidden) && (
          <button
            className={`icon-btn icon-btn--small${hidden ? ' icon-btn--active' : ''}`}
            onClick={() => setHidden((v) => !v)}
            aria-pressed={hidden}
            title={hidden ? 'Show markings on this device' : 'Hide markings on this device'}
          >
            {hidden ? <IconEyeOff size={14} /> : <IconEye size={14} />}
          </button>
        )}
        <button
          className="icon-btn icon-btn--small"
          onClick={() => onRotate(device.uid)}
          title="Rotate orientation (portrait/landscape)"
        >
          <IconRotateDevice size={14} />
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

      <div
        className="device__viewport"
        style={{
          width: Math.round(width * zoom),
          height: Math.round(height * zoom),
        }}
      >
        <iframe
          // Der key erzwingt beim Reload einen frischen Frame statt eines
          // src-Wechsels — sonst bleibt eine blockierte Fehlerseite stehen.
          key={`${reloadKey}:${src}`}
          ref={attachRef}
          src={src}
          width={width}
          height={height}
          style={{ transform: `scale(${zoom})` }}
          onLoad={(e) => {
            setLoadCount((c) => c + 1);
            onLoad(device, e.currentTarget);
          }}
        />

        <AnnotationOverlay
          width={width}
          height={height}
          zoom={zoom}
          active={annotating}
          shapes={visibleShapes}
          dimmedIds={dimmedIds}
          tool={tool}
          color={color}
          showNotes={showNotes}
          flashShapeId={flashShapeId}
          flashNonce={flashNonce}
          hoverShapeId={hoverShapeId}
          editRequest={noteEdit}
          frameEl={frameEl}
          loadCount={loadCount}
          onAdd={(shape) => onAddShape(device.uid, shape)}
          onSetNote={(shapeId, note) => onSetShapeNote(device.uid, shapeId, note)}
        />
      </div>
    </div>
  );
}
