import { fileExtension, fileFormatOf, formatBytes, validateFile } from './file-validation';

const MAX = 10 * 1024 * 1024;

describe('file-validation', () => {
  describe('validateFile', () => {
    it('acepta .txt, .pdf y .md sin distinguir mayúsculas', () => {
      for (const name of ['a.txt', 'a.PDF', 'notas.Md']) {
        expect(validateFile({ name, size: 10 }, MAX)).toBeNull();
      }
    });

    it('acepta un archivo de exactamente el tamaño máximo', () => {
      expect(validateFile({ name: 'a.pdf', size: MAX }, MAX)).toBeNull();
    });

    it('rechaza una extensión no soportada indicando la detectada', () => {
      expect(validateFile({ name: 'plano.dwg', size: 10 }, MAX)).toBe(
        'Formato no soportado (.dwg detectado). Solo se admiten archivos TXT, PDF o MD',
      );
    });

    it('rechaza un nombre sin extensión', () => {
      expect(validateFile({ name: 'LEEME', size: 10 }, MAX)).toBe(
        'Formato no soportado. Solo se admiten archivos TXT, PDF o MD',
      );
    });

    it('rechaza un archivo vacío', () => {
      expect(validateFile({ name: 'a.txt', size: 0 }, MAX)).toBe('El archivo está vacío');
    });

    it('rechaza un archivo por encima del máximo con el límite legible', () => {
      expect(validateFile({ name: 'a.pdf', size: MAX + 1 }, MAX)).toBe(
        'El archivo supera el tamaño máximo permitido (10 MB)',
      );
    });

    it('rechaza un nombre vacío, demasiado largo o con caracteres de control', () => {
      const invalid = 'Nombre de archivo inválido';
      expect(validateFile({ name: '', size: 10 }, MAX)).toBe(invalid);
      expect(validateFile({ name: `${'a'.repeat(253)}.md`, size: 10 }, MAX)).toBe(invalid);
      expect(validateFile({ name: 'a\u0000b.md', size: 10 }, MAX)).toBe(invalid);
    });

    it('rechaza marcas bidireccionales que disfrazan la extensión (U+202E)', () => {
      expect(validateFile({ name: 'informe\u202egnp.md', size: 10 }, MAX)).toBe('Nombre de archivo inválido');
      expect(validateFile({ name: 'a\u200f.txt', size: 10 }, MAX)).toBe('Nombre de archivo inválido');
    });

    it('acepta un nombre de exactamente 255 caracteres', () => {
      expect(validateFile({ name: `${'a'.repeat(252)}.md`, size: 10 }, MAX)).toBeNull();
    });

    it('evalúa primero el nombre, luego el formato, el vacío y el tamaño', () => {
      expect(validateFile({ name: 'a\u0001.dwg', size: 0 }, MAX)).toBe('Nombre de archivo inválido');
      expect(validateFile({ name: 'a.dwg', size: 0 }, MAX)).toContain('Formato no soportado');
    });
  });

  describe('fileFormatOf / fileExtension', () => {
    it('devuelve el formato por extensión', () => {
      expect(fileFormatOf('a.txt')).toBe('TXT');
      expect(fileFormatOf('a.PDF')).toBe('PDF');
      expect(fileFormatOf('a.md')).toBe('MD');
      expect(fileFormatOf('a.docx')).toBeNull();
    });

    it('usa la última extensión y no toma como extensión un nombre oculto', () => {
      expect(fileExtension('informe.v2.pdf')).toBe('.pdf');
      expect(fileExtension('.md')).toBe('');
      expect(fileExtension('sin-extension')).toBe('');
    });
  });

  describe('formatBytes', () => {
    it('formatea bytes, KB y MB con una decimal como máximo', () => {
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(1536)).toBe('1.5 KB');
      expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB');
      expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
    });

    it('llega hasta GB', () => {
      expect(formatBytes(2 * 1024 ** 3)).toBe('2 GB');
    });
  });
});
