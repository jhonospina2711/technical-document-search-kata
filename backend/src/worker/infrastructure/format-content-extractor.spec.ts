import { DocumentFormat } from '../../documents/domain/document';
import { UnsupportedFormatError } from '../application/errors';
import { FormatContentExtractor } from './format-content-extractor';
import { PdfContentExtractor } from './pdf-content-extractor';
import { TextContentExtractor } from './text-content-extractor';

describe('FormatContentExtractor', () => {
  const text = { extract: jest.fn().mockResolvedValue('texto') };
  const pdf = { extract: jest.fn().mockResolvedValue('pdf') };
  const extractor = new FormatContentExtractor(
    text as unknown as TextContentExtractor,
    pdf as unknown as PdfContentExtractor,
  );
  const content = Buffer.from('contenido');

  beforeEach(() => jest.clearAllMocks());

  it.each([DocumentFormat.TXT, DocumentFormat.MD])('delega %s en el extractor de texto', async (format) => {
    await expect(extractor.extract(format, content)).resolves.toBe('texto');
    expect(text.extract).toHaveBeenCalledWith(format, content);
    expect(pdf.extract).not.toHaveBeenCalled();
  });

  it('delega PDF en el extractor de PDF', async () => {
    await expect(extractor.extract(DocumentFormat.PDF, content)).resolves.toBe('pdf');
    expect(pdf.extract).toHaveBeenCalledWith(DocumentFormat.PDF, content);
    expect(text.extract).not.toHaveBeenCalled();
  });

  it('rechaza un formato sin extractor (AC-08)', async () => {
    await expect(extractor.extract('DOCX' as DocumentFormat, content)).rejects.toThrow(UnsupportedFormatError);
  });

  it('propaga los errores del extractor delegado', async () => {
    const error = new Error('fallo');
    pdf.extract.mockRejectedValueOnce(error);

    await expect(extractor.extract(DocumentFormat.PDF, content)).rejects.toBe(error);
  });
});
