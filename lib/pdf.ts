/**
 * Minimal PDF writer for the screenshot export.
 *
 * Deliberately hand-written rather than jsPDF or pdf-lib: what is needed is a
 * few pages with embedded images and clickable areas — pulling several hundred
 * kilobytes of library into the content script for that would be out of
 * proportion. Images go in losslessly as `/FlateDecode`;
 * `CompressionStream('deflate')` produces exactly the zlib stream PDF expects.
 */

/** An image at a position on the page (coordinates from the *top* left, in pt). */
export interface PdfImage {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A clickable area (coordinates from the *top* left, in pt). */
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

/** Raw RGB bytes of a canvas (alpha is dropped — the page is opaque). */
function toRgb(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D context not available');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rgb = new Uint8Array((data.length / 4) * 3);
  for (let i = 0, o = 0; i < data.length; i += 4, o += 3) {
    rgb[o] = data[i]!;
    rgb[o + 1] = data[i + 1]!;
    rgb[o + 2] = data[i + 2]!;
  }
  return rgb;
}

/** Escape text for use in a PDF string. */
function pdfString(value: string): string {
  return `(${value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

const enc = new TextEncoder();

/**
 * One page of the document. `width`/`height` are points (1 pt = 1/72 inch);
 * every coordinate inside comes from the *top* left.
 */
export interface PdfPage {
  width: number;
  height: number;
  images: PdfImage[];
  links: PdfLink[];
}

/**
 * Builds the PDF. Each page brings its own size — the full-page shot is metres
 * tall, the detail shots next to it are not. Coordinates are flipped here onto
 * the PDF system (origin at the bottom left).
 */
export async function buildPdf(pages: PdfPage[], title: string): Promise<Blob> {
  /** Finished object bodies; index + 1 is the object number. */
  const objects: (Uint8Array | string)[] = [];
  const add = (body: Uint8Array | string): number => {
    objects.push(body);
    return objects.length; // 1-basiert
  };

  // Reserve the catalog and the page tree up front: they point at the pages
  // and the pages point back at the tree, so the numbers have to be fixed.
  const catalogId = add('');
  const pagesId = add('');
  const pageIds = pages.map(() => add(''));

  for (let p = 0; p < pages.length; p++) {
    const page = pages[p]!;
    const { height } = page;

    // Images as XObjects. Own resources per page — no image appears on two of
    // them, so shared entries would be bookkeeping without a saving.
    const drawOps: string[] = [];
    const xobjects: string[] = [];
    for (let i = 0; i < page.images.length; i++) {
      const img = page.images[i]!;
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
      // cm sets the image matrix: width/height and the *bottom* left corner.
      drawOps.push(
        `q ${img.w.toFixed(2)} 0 0 ${img.h.toFixed(2)} ${img.x.toFixed(2)} ` +
          `${(height - img.y - img.h).toFixed(2)} cm ${name} Do Q`,
      );
    }

    // Link annotations over the buttons that were drawn.
    const annotIds = page.links.map((l) =>
      add(
        `<< /Type /Annot /Subtype /Link /Rect [${l.x.toFixed(2)} ` +
          `${(height - l.y - l.h).toFixed(2)} ${(l.x + l.w).toFixed(2)} ` +
          `${(height - l.y).toFixed(2)}] /Border [0 0 0] /F 4 ` +
          `/A << /S /URI /URI ${pdfString(l.url)} >> >>`,
      ),
    );

    const content = drawOps.join('\n');
    const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    objects[pageIds[p]! - 1] =
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${page.width.toFixed(2)} ${height.toFixed(2)}] ` +
      `/Resources << /XObject << ${xobjects.join(' ')} >> >> /Contents ${contentId} 0 R ` +
      (annotIds.length > 0 ? `/Annots [${annotIds.map((id) => `${id} 0 R`).join(' ')}] ` : '') +
      '>>';
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] ` +
    `/Count ${pages.length} >>`;

  // Assemble it, cross-reference table included.
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
