/**
 * Minimaler PDF-Writer fuer den Screenshot-Export.
 *
 * Bewusst selbst geschrieben statt jsPDF/pdf-lib: gebraucht wird genau eine
 * Seite mit ein paar eingebetteten Bildern und anklickbaren Flaechen — dafuer
 * eine Bibliothek von mehreren hundert Kilobyte ins Content-Script zu ziehen
 * waere unverhaeltnismaessig. Bilder gehen verlustfrei als `/FlateDecode`
 * hinein; `CompressionStream('deflate')` liefert genau den zlib-Strom, den
 * PDF dafuer erwartet.
 */

/** Bild an einer Position der Seite (Koordinaten von *oben* links, in pt). */
export interface PdfImage {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Anklickbare Flaeche (Koordinaten von *oben* links, in pt). */
export interface PdfLink {
  x: number;
  y: number;
  w: number;
  h: number;
  url: string;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Rohe RGB-Bytes eines Canvas (Alpha faellt weg — die Seite ist deckend). */
function toRgb(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D-Kontext nicht verfuegbar');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rgb = new Uint8Array((data.length / 4) * 3);
  for (let i = 0, o = 0; i < data.length; i += 4, o += 3) {
    rgb[o] = data[i]!;
    rgb[o + 1] = data[i + 1]!;
    rgb[o + 2] = data[i + 2]!;
  }
  return rgb;
}

/** Text fuer einen PDF-String maskieren. */
function pdfString(value: string): string {
  return `(${value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

const enc = new TextEncoder();

/**
 * Baut ein einseitiges PDF. `width`/`height` sind Punkte (1 pt = 1/72 Zoll);
 * alle Koordinaten kommen von oben links und werden hier auf das
 * PDF-Koordinatensystem (Ursprung unten links) gedreht.
 */
export async function buildPdf(
  width: number,
  height: number,
  images: PdfImage[],
  links: PdfLink[],
  title: string,
): Promise<Blob> {
  /** Fertige Objekt-Koerper; Index + 1 ist die Objektnummer. */
  const objects: (Uint8Array | string)[] = [];
  const add = (body: Uint8Array | string): number => {
    objects.push(body);
    return objects.length; // 1-basiert
  };

  // 1..4 werden weiter unten gefuellt — die Nummern muessen vorab feststehen,
  // weil sie sich gegenseitig referenzieren.
  const catalogId = add('');
  const pagesId = add('');
  const pageId = add('');
  const contentId = add('');

  // Bilder als XObjects.
  const drawOps: string[] = [];
  const xobjects: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    const packed = await deflate(toRgb(img.canvas));
    const header = enc.encode(
      `<< /Type /XObject /Subtype /Image /Width ${img.canvas.width} ` +
        `/Height ${img.canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
        `/Filter /FlateDecode /Length ${packed.length} >>\nstream\n`,
    );
    const footer = enc.encode('\nendstream');
    const body = new Uint8Array(header.length + packed.length + footer.length);
    body.set(header, 0);
    body.set(packed, header.length);
    body.set(footer, header.length + packed.length);
    const id = add(body);
    const name = `/Im${i}`;
    xobjects.push(`${name} ${id} 0 R`);
    // cm setzt die Bildmatrix: Breite/Hoehe und linke *untere* Ecke.
    drawOps.push(
      `q ${img.w.toFixed(2)} 0 0 ${img.h.toFixed(2)} ${img.x.toFixed(2)} ` +
        `${(height - img.y - img.h).toFixed(2)} cm ${name} Do Q`,
    );
  }

  // Link-Annotationen ueber den gezeichneten Knoepfen.
  const annotIds = links.map((l) =>
    add(
      `<< /Type /Annot /Subtype /Link /Rect [${l.x.toFixed(2)} ` +
        `${(height - l.y - l.h).toFixed(2)} ${(l.x + l.w).toFixed(2)} ` +
        `${(height - l.y).toFixed(2)}] /Border [0 0 0] /F 4 ` +
        `/A << /S /URI /URI ${pdfString(l.url)} >> >>`,
    ),
  );

  const content = drawOps.join('\n');
  objects[contentId - 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`;
  objects[pageId - 1] =
    `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${width.toFixed(2)} ${height.toFixed(2)}] ` +
    `/Resources << /XObject << ${xobjects.join(' ')} >> >> /Contents ${contentId} 0 R ` +
    (annotIds.length > 0 ? `/Annots [${annotIds.map((id) => `${id} 0 R`).join(' ')}] ` : '') +
    '>>';

  // Zusammensetzen samt Querverweistabelle.
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const push = (part: Uint8Array | string) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    offset += bytes.length;
  };

  push(`%PDF-1.4\n%âãÏÓ\n`);
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset);
    push(`${i + 1} 0 obj\n`);
    push(objects[i]!);
    push('\nendobj\n');
  }

  const xrefAt = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R ` +
      `/Info << /Title ${pdfString(title)} /Producer (Inkspect) >> >>\n` +
      `startxref\n${xrefAt}\n%%EOF\n`,
  );

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}
