import { DocumentFormat } from '../../documents/domain/document';
import { ContentExtractionError, UnsupportedFormatError } from '../application/errors';
import { TextContentExtractor } from './text-content-extractor';

describe('TextContentExtractor', () => {
  const extractor = new TextContentExtractor();

  it.each([DocumentFormat.TXT, DocumentFormat.MD])('normaliza BOM, saltos de línea y bordes en %s (AC-02)', async (format) => {
    const raw = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('  \r\n# Título\r\nlínea 1\rlínea 2\n\n  ')]);

    await expect(extractor.extract(format, raw)).resolves.toBe('# Título\nlínea 1\nlínea 2');
  });

  it('conserva los acentos y la sintaxis Markdown', async () => {
    await expect(extractor.extract(DocumentFormat.MD, Buffer.from('**ñandú** `código`'))).resolves.toBe('**ñandú** `código`');
  });

  it('rechaza UTF-8 inválido', async () => {
    await expect(extractor.extract(DocumentFormat.TXT, Buffer.from([0xc3, 0x28]))).rejects.toThrow(ContentExtractionError);
  });

  it('rechaza bytes nulos', async () => {
    await expect(extractor.extract(DocumentFormat.TXT, Buffer.from('a\0b'))).rejects.toThrow(ContentExtractionError);
  });

  it('rechaza contenido vacío o solo espacios', async () => {
    await expect(extractor.extract(DocumentFormat.TXT, Buffer.from(' \r\n\t '))).rejects.toThrow(ContentExtractionError);
  });

  it('no soporta PDF hasta KTL-11', async () => {
    await expect(extractor.extract(DocumentFormat.PDF, Buffer.from('%PDF-1.7'))).rejects.toThrow(UnsupportedFormatError);
  });

  it('los errores no incluyen el contenido del archivo', async () => {
    await expect(extractor.extract(DocumentFormat.TXT, Buffer.from('secreto\0'))).rejects.not.toThrow(/secreto/);
  });
});
