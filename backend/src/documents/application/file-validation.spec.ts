import { DocumentFormat } from '../domain/document';
import {
  EmptyFileError,
  InvalidFileContentError,
  InvalidFileNameError,
  UnsupportedFileFormatError,
} from '../domain/errors';
import { baseName, validateUploadedFile } from './file-validation';

const text = (value: string) => Buffer.from(value, 'utf-8');
const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n');
const validate = (originalName: string, content: Buffer) => validateUploadedFile({ originalName, content });

describe('validateUploadedFile', () => {
  it.each([
    ['nota.txt', text('hola'), DocumentFormat.TXT],
    ['guia.md', text('# Título\ncontenido'), DocumentFormat.MD],
    ['manual.pdf', pdf, DocumentFormat.PDF],
  ])('acepta %s', (name, content, fileFormat) => {
    expect(validate(name, content)).toEqual({ fileName: name, fileFormat });
  });

  it('no distingue mayúsculas y usa la última extensión', () => {
    expect(validate('Informe.v2.MD', text('x'))).toEqual({ fileName: 'Informe.v2.MD', fileFormat: DocumentFormat.MD });
    expect(validate('MANUAL.PDF', pdf).fileFormat).toBe(DocumentFormat.PDF);
  });

  it('devuelve solo el nombre base', () => {
    expect(validate('../../x.md', text('x')).fileName).toBe('x.md');
    expect(validate('C:\\docs\\x.txt', text('x')).fileName).toBe('x.txt');
  });

  it.each(['programa.exe', 'informe.docx', 'pagina.html', 'sin-extension', 'archivo.'])(
    'rechaza el formato no soportado: %s',
    (name) => {
      expect(() => validate(name, text('x'))).toThrow(UnsupportedFileFormatError);
    },
  );

  it('rechaza un archivo vacío', () => {
    expect(() => validate('vacio.txt', Buffer.alloc(0))).toThrow(EmptyFileError);
  });

  describe('contenido', () => {
    it('acepta un PDF cuya firma está dentro de los primeros 1024 bytes', () => {
      expect(validate('a.pdf', Buffer.concat([Buffer.alloc(1000, 0x20), pdf])).fileFormat).toBe(DocumentFormat.PDF);
    });

    it('rechaza un PDF sin firma o con la firma después de 1024 bytes', () => {
      expect(() => validate('a.pdf', text('solo texto'))).toThrow(InvalidFileContentError);
      expect(() => validate('a.pdf', Buffer.concat([Buffer.alloc(1024, 0x20), pdf]))).toThrow(InvalidFileContentError);
    });

    it('rechaza TXT o MD con bytes NUL', () => {
      expect(() => validate('a.txt', Buffer.from([0x68, 0x00, 0x69]))).toThrow(InvalidFileContentError);
      expect(() => validate('a.md', Buffer.from([0x00]))).toThrow(InvalidFileContentError);
    });

    it('rechaza TXT o MD con UTF-8 inválido', () => {
      expect(() => validate('a.txt', Buffer.from([0xff, 0xfe, 0x41]))).toThrow(InvalidFileContentError);
      expect(() => validate('a.md', Buffer.from('cañón', 'latin1'))).toThrow(InvalidFileContentError);
    });

    it('acepta UTF-8 con BOM y caracteres no ASCII', () => {
      expect(validate('a.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), text('cañón ✓')])).fileFormat).toBe(
        DocumentFormat.TXT,
      );
    });

    it('menciona el formato en el mensaje', () => {
      expect(() => validate('a.pdf', text('x'))).toThrow('El contenido del archivo no corresponde al formato PDF');
    });
  });

  describe('nombre', () => {
    it('rechaza nombres de más de 255 caracteres', () => {
      expect(() => validate(`${'a'.repeat(253)}.md`, text('x'))).toThrow(InvalidFileNameError);
      expect(validate(`${'a'.repeat(252)}.md`, text('x')).fileFormat).toBe(DocumentFormat.MD);
    });

    it('rechaza nombres con caracteres de control', () => {
      expect(() => validate('a\u0000.md', text('x'))).toThrow(InvalidFileNameError);
      expect(() => validate('a\nb.md', text('x'))).toThrow(InvalidFileNameError);
    });

    it('rechaza nombres vacíos o que son solo una ruta', () => {
      expect(() => validate('', text('x'))).toThrow(InvalidFileNameError);
      expect(() => validate('carpeta/', text('x'))).toThrow(InvalidFileNameError);
    });
  });

  it('evalúa nombre antes que formato, y formato antes que vacío y contenido', () => {
    expect(() => validate('a\u0000.exe', Buffer.alloc(0))).toThrow(InvalidFileNameError);
    expect(() => validate('a.exe', Buffer.alloc(0))).toThrow(UnsupportedFileFormatError);
    expect(() => validate('a.pdf', Buffer.alloc(0))).toThrow(EmptyFileError);
  });
});

describe('baseName', () => {
  it('quita rutas con / y \\', () => {
    expect(baseName('a/b\\c.txt')).toBe('c.txt');
  });
});
