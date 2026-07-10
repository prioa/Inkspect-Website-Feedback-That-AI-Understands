import { useCallback, useRef, useState } from 'react';
import { viewport, type DeviceInstance } from '@/lib/devices';
import type { Shape, Tool } from '@/lib/annotations';
import { AnnotationOverlay } from './AnnotationOverlay';
import { deviceIcon } from './Toolbar';
import { IconClose, IconRotateDevice } from './icons';

interface Props {
  device: DeviceInstance;
  src: string;
  zoom: number;
  /** Aendert sich, wenn alle Frames neu geladen werden sollen. */
  reloadKey: number;
  /** Globaler Zeichenmodus — die Overlays aller Frames sind scharf. */
  annotating: boolean;
  shapes: Shape[];
  tool: Tool;
  color: string;
  onLoad: (device: DeviceInstance, iframe: HTMLIFrameElement) => void;
  onAttach: (device: DeviceInstance, iframe: HTMLIFrameElement | null) => void;
  onRotate: (uid: string) => void;
  onRemove: (uid: string) => void;
  onAddShape: (uid: string, shape: Shape) => void;
  onSetShapeNote: (uid: string, shapeId: string, note: string) => void;
}

export function DeviceFrame({
  device,
  src,
  zoom,
  reloadKey,
  annotating,
  shapes,
  tool,
  color,
  onLoad,
  onAttach,
  onRotate,
  onRemove,
  onAddShape,
  onSetShapeNote,
}: Props) {
  const { width, height } = viewport(device);

  // Lokale Referenz + Load-Zaehler fuer das Annotations-Overlay (Scroll-Tracking).
  const [frameEl, setFrameEl] = useState<HTMLIFrameElement | null>(null);
  const [loadCount, setLoadCount] = useState(0);

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
    <div className={`device${annotating ? ' device--annotating' : ''}`} data-uid={device.uid}>
      <div className="device__bar">
        <span className="device__icon">{deviceIcon(width, 15)}</span>
        <span className="device__name">{device.name}</span>
        <span className="device__size">
          {width}×{height}
        </span>
        {shapes.length > 0 && <span className="device__anno-count">{shapes.length}</span>}
        <span className="device__bar-spacer" />
        <button
          className="icon-btn icon-btn--small"
          onClick={() => onRotate(device.uid)}
          title="Ausrichtung drehen (Hoch-/Querformat)"
        >
          <IconRotateDevice size={14} />
        </button>
        <button
          className="icon-btn icon-btn--small icon-btn--danger"
          onClick={() => onRemove(device.uid)}
          title="Entfernen"
        >
          <IconClose size={14} />
        </button>
      </div>

      <div
        className="device__viewport"
        style={{ width: Math.round(width * zoom), height: Math.round(height * zoom) }}
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
          shapes={shapes}
          tool={tool}
          color={color}
          frameEl={frameEl}
          loadCount={loadCount}
          onAdd={(shape) => onAddShape(device.uid, shape)}
          onSetNote={(shapeId, note) => onSetShapeNote(device.uid, shapeId, note)}
        />
      </div>
    </div>
  );
}
