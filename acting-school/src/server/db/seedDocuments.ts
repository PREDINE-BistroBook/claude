/**
 * Demo documents for the seed script: a one-page PDF (A4, Helvetica, Latin
 * text) written by hand — header, five objects, a correct cross-reference
 * table — so the workshop and casting "Files" have something real to open.
 */

const escapePdf = (text: string) => text.replace(/[\\()]/g, (ch) => `\\${ch}`).replace(/[^\x20-\x7e]/g, '?');

/** A one-page PDF with a title and lines of text. */
export function renderPdf(title: string, lines: readonly string[]): Uint8Array<ArrayBuffer> {
  const content = [
    'BT',
    '/F1 20 Tf',
    '56 770 Td',
    `(${escapePdf(title)}) Tj`,
    '/F1 12 Tf',
    '0 -20 Td',
    ...lines.flatMap((line) => ['0 -18 Td', `(${escapePdf(line)}) Tj`]),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) out += `${String(at).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character is ASCII, so string offsets are byte offsets.
  return new Uint8Array(new TextEncoder().encode(out));
}
