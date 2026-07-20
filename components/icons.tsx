import type { ReactNode } from 'react';

/**
 * Inline-SVG-Icons (Feather-Stil, stroke: currentColor). Als Komponenten
 * statt Icon-Font, damit im Shadow Tree nichts nachgeladen werden muss.
 */
function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type IconProps = { size?: number };

export const IconReload = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </Icon>
);

/** Kompass — Einstieg in die gefuehrte Tour. */
export const IconCompass = ({ size }: IconProps) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2 5-5 2 2-5z" />
  </Icon>
);

export const IconCode = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="m16 18 6-6-6-6" />
    <path d="m8 6-6 6 6 6" />
  </Icon>
);

export const IconLink = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Icon>
);

export const IconLinkOff = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M10 13a5 5 0 0 0 1.4 1.06" />
    <path d="M17.54 13.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-1.4-1.06" />
    <path d="M6.46 10.46l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    <path d="m2 2 20 20" />
  </Icon>
);

export const IconClose = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>
);

export const IconTrash = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Icon>
);

export const IconUndo = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
);

export const IconCheck = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

export const IconPen = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M3 17c3-6 5-8 7-6s-2 6 1 6 5-8 10-11" />
  </Icon>
);

/** Klassischer Stift (Bearbeiten) — nicht der Freihand-Kringel von IconPen. */
export const IconEditPen = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </Icon>
);

export const IconRect = ({ size }: IconProps) => (
  <Icon size={size}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
  </Icon>
);

export const IconEllipse = ({ size }: IconProps) => (
  <Icon size={size}>
    <ellipse cx="12" cy="12" rx="9" ry="6.5" />
  </Icon>
);

export const IconArrow = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M5 19 19 5" />
    <path d="M9 5h10v10" />
  </Icon>
);

/** Griff zum Verschieben der Werkzeugleiste (sechs Punkte). */
export const IconGrip = ({ size }: IconProps) => (
  <Icon size={size}>
    <circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none" />
  </Icon>
);

/** Waagerechte Hilfslinie ueber die volle Breite — die Endkappen zeigen den Rand. */
export const IconHLine = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M3 12h18" />
    <path d="M3 8v8" />
    <path d="M21 8v8" />
  </Icon>
);

/** Senkrechte Hilfslinie ueber die volle Hoehe. */
export const IconVLine = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M12 3v18" />
    <path d="M8 3h8" />
    <path d="M8 21h8" />
  </Icon>
);

export const IconText = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M4 7V5h16v2" />
    <path d="M12 5v14" />
    <path d="M9 19h6" />
  </Icon>
);

export const IconPointer = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3Z" />
    <path d="m13 13 6 6" />
  </Icon>
);

/** Element-Picker: Rahmen mit Cursor-Pfeil (DevTools-Inspektor-Metapher). */
export const IconInspect = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M10 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5" />
    <path d="m13 13 8 3-3.6 1.4L16 21l-3-8Z" />
  </Icon>
);

/** Schrift-Inspector: Lupe mit „A" — Text unter dem Cursor untersuchen. */
export const IconInspector = ({ size }: IconProps) => (
  <Icon size={size}>
    <circle cx="10" cy="10" r="7" />
    <path d="m20 20-4-4" />
    <path d="M8 12.5 10 7l2 5.5" />
    <path d="M8.6 11h2.8" />
  </Icon>
);

export const IconTerminal = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="m4 17 6-6-6-6" />
    <path d="M12 19h8" />
  </Icon>
);

/** Geraet drehen: Querformat-Rahmen mit Drehpfeil von oben. */
export const IconRotateDevice = ({ size }: IconProps) => (
  <Icon size={size}>
    <rect x="2.5" y="11" width="13" height="10" rx="2" />
    <path d="M9 7a10 10 0 0 1 12 7" />
    <path d="M21 10v4h-4" />
  </Icon>
);

export const IconPin = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </Icon>
);

export const IconMessage = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
  </Icon>
);

export const IconCopy = ({ size }: IconProps) => (
  <Icon size={size}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Icon>
);

export const IconPhone = ({ size }: IconProps) => (
  <Icon size={size}>
    <rect x="7" y="2" width="10" height="20" rx="2" />
    <path d="M11 18h2" />
  </Icon>
);

export const IconTablet = ({ size }: IconProps) => (
  <Icon size={size}>
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <path d="M11 18h2" />
  </Icon>
);

export const IconMonitor = ({ size }: IconProps) => (
  <Icon size={size}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8" />
    <path d="M12 17v4" />
  </Icon>
);

export const IconPlus = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Icon>
);

export const IconMinus = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M5 12h14" />
  </Icon>
);

export const IconDownload = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" />
    <path d="M12 15V3" />
  </Icon>
);

export const IconUpload = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 8 5-5 5 5" />
    <path d="M12 3v12" />
  </Icon>
);

export const IconDots = ({ size }: IconProps) => (
  <Icon size={size}>
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="19" r="1" />
  </Icon>
);

export const IconEye = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const IconEyeOff = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-10-7-10-7a17.4 17.4 0 0 1 4.06-4.94" />
    <path d="M9.9 5.24A9.6 9.6 0 0 1 12 5c7 0 10 7 10 7a17.5 17.5 0 0 1-1.67 2.68" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <path d="m2 2 20 20" />
  </Icon>
);

/** Vollbild betreten: vier Ecken nach aussen. */
export const IconExpand = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M15 3h6v6" />
    <path d="M9 21H3v-6" />
    <path d="M21 3l-7 7" />
    <path d="M3 21l7-7" />
  </Icon>
);

/** Vollbild verlassen: Pfeile nach innen. */
export const IconCollapse = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M4 14h6v6" />
    <path d="M20 10h-6V4" />
    <path d="M14 10l7-7" />
    <path d="M3 21l7-7" />
  </Icon>
);

/** Touch-Modus: tippender Finger. */
export const IconTouch = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M9 11V5a2 2 0 0 1 4 0v6" />
    <path d="M13 9.5a2 2 0 0 1 4 1V13" />
    <path d="M17 12.5a2 2 0 0 1 3.5 1.5c0 2.5-1 4-2 6-.8 1.7-2.4 2-4.5 2h-1.8c-1.8 0-2.9-.6-3.9-2L5 15.5a1.9 1.9 0 0 1 3-2.3l1 1.3" />
  </Icon>
);

export const IconGlobe = ({ size }: IconProps) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
  </Icon>
);

export const IconSun = ({ size }: IconProps) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

export const IconMoon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </Icon>
);

/** Theme folgt dem System: halb Sonne, halb Mond (Kreis mit Trennlinie). */
export const IconThemeAuto = ({ size }: IconProps) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v18" />
    <path d="M12 8a4 4 0 0 0 0 8" fill="currentColor" stroke="none" />
  </Icon>
);

export const IconWarning = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Icon>
);

export const IconHelp = ({ size }: IconProps) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4" />
    <path d="M12 17h.01" />
  </Icon>
);

/** Zeilenfuellend zoomen: Rahmen mit Pfeilen nach links/rechts. */
export const IconFit = ({ size }: IconProps) => (
  <Icon size={size}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M8 10l-2 2 2 2" />
    <path d="M16 10l2 2-2 2" />
  </Icon>
);

/** Device-Set: gestapelte Ebenen. */
export const IconLayers = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M12 2 2 7l10 5 10-5-10-5Z" />
    <path d="m2 12 10 5 10-5" />
    <path d="m2 17 10 5 10-5" />
  </Icon>
);

export const IconSave = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
    <path d="M17 21v-8H7v8M7 3v5h8" />
  </Icon>
);
