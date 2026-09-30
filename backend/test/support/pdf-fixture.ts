/**
 * Genera un PDF mínimo con una página por texto (fuente Helvetica, sin binarios en el repositorio).
 * Con `encrypted` añade un diccionario `/Encrypt` estándar que exige contraseña, por lo que pdfjs
 * lo rechaza con `PasswordException`.
 */
export function buildPdf(pages: string[], { encrypted = false }: { encrypted?: boolean } = {}): Buffer {
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((text, i) => {
    const stream = `BT /F1 12 Tf 10 100 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });

  let trailerExtra = '';
  if (encrypted) {
    objects.push(`<< /Filter /Standard /V 1 /R 2 /O <${'00'.repeat(32)}> /U <${'11'.repeat(32)}> /P -4 >>`);
    const id = '00112233445566778899aabbccddeeff';
    trailerExtra = ` /Encrypt ${objects.length} 0 R /ID [<${id}> <${id}>]`;
  }

  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = body.length;
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xref}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${trailerExtra} >>\nstartxref\n${body.indexOf('xref\n')}\n%%EOF`;
  return Buffer.from(body, 'latin1');
}
