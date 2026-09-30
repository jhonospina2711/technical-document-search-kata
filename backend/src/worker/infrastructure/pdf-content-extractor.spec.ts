import { extractText, getDocumentProxy } from 'unpdf';
import { DocumentFormat } from '../../documents/domain/document';
import { ContentExtractionError } from '../application/errors';
import { MAX_PDF_PAGES, PdfContentExtractor } from './pdf-content-extractor';

jest.mock('unpdf');

const getProxy = jest.mocked(getDocumentProxy);
const extract = jest.mocked(extractText);

function pdfjsError(name: string, message = 'fragmento secreto del archivo'): Error {
  return Object.assign(new Error(message), { name });
}

describe('PdfContentExtractor', () => {
  const extractor = new PdfContentExtractor();
  const destroy = jest.fn();

  function givenPdf(pages: string[], numPages = pages.length): void {
    getProxy.mockResolvedValue({ numPages, loadingTask: { destroy } } as never);
    extract.mockResolvedValue({ totalPages: numPages, text: pages });
  }

  const run = () => extractor.extract(DocumentFormat.PDF, Buffer.from('%PDF-1.7'));

  beforeEach(() => {
    jest.resetAllMocks();
    destroy.mockResolvedValue(undefined);
  });

  it('une las páginas normalizadas con una línea en blanco y descarta las vacías (AC-01)', async () => {
    givenPdf(['  Página uno\r\n', ' \n', 'Pági\u0000na dos\r']);

    await expect(run()).resolves.toBe('Página uno\n\nPágina dos');
    expect(extract).toHaveBeenCalledWith(expect.anything(), { mergePages: false });
    expect(destroy).toHaveBeenCalled();
  });

  it('entrega a pdfjs una copia y no el Buffer del llamador', async () => {
    givenPdf(['texto']);
    const original = Buffer.from('%PDF-1.7');

    await extractor.extract(DocumentFormat.PDF, original);

    const received = getProxy.mock.calls[0][0] as Uint8Array;
    expect(received).toEqual(new Uint8Array(original));
    expect(received.buffer).not.toBe(original.buffer);
  });

  it('procesa un PDF de exactamente 500 páginas', async () => {
    givenPdf(['texto'], MAX_PDF_PAGES);

    await expect(run()).resolves.toBe('texto');
  });

  it('rechaza más de 500 páginas sin extraer texto (AC-05)', async () => {
    givenPdf(['texto'], MAX_PDF_PAGES + 1);

    await expect(run()).rejects.toThrow(new ContentExtractionError('El PDF supera el máximo de 500 páginas'));
    expect(extract).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });

  it('rechaza un PDF sin capa de texto (AC-04)', async () => {
    givenPdf([' ', '\n\u0000']);

    await expect(run()).rejects.toThrow(new ContentExtractionError('El archivo no contiene texto extraíble'));
  });

  it('mapea un PDF protegido con contraseña (AC-02)', async () => {
    getProxy.mockRejectedValue(pdfjsError('PasswordException'));

    await expect(run()).rejects.toThrow(new ContentExtractionError('El PDF está protegido con contraseña'));
  });

  it.each(['InvalidPDFException', 'FormatError', 'MissingPDFException', 'UnexpectedResponseException'])(
    'mapea %s a PDF dañado (AC-03)',
    async (name) => {
      getProxy.mockRejectedValue(pdfjsError(name));

      const error = await run().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ContentExtractionError);
      expect((error as Error).message).toBe('El PDF está dañado o no se puede leer');
    },
  );

  it('mapea también los fallos de extractText y libera el documento', async () => {
    getProxy.mockResolvedValue({ numPages: 1, loadingTask: { destroy } } as never);
    extract.mockRejectedValue(pdfjsError('FormatError'));

    await expect(run()).rejects.toBeInstanceOf(ContentExtractionError);
    expect(destroy).toHaveBeenCalled();
  });

  it('no incluye el mensaje original de pdfjs', async () => {
    getProxy.mockRejectedValue(pdfjsError('InvalidPDFException', 'secreto'));

    await expect(run()).rejects.not.toThrow(/secreto/);
  });

  it('propaga RangeError sin mapear (AC-07)', async () => {
    const error = new RangeError('Maximum call stack size exceeded');
    getProxy.mockRejectedValue(error);

    await expect(run()).rejects.toBe(error);
  });

  it('propaga sin mapear un error inesperado, como un fallo al cargar pdfjs (AC-07)', async () => {
    const error = new Error('Serverless PDF.js bundle could not be resolved');
    getProxy.mockRejectedValue(error);

    await expect(run()).rejects.toBe(error);
  });

  it('propaga un valor lanzado que no es un Error', async () => {
    getProxy.mockRejectedValue('boom');

    await expect(run()).rejects.toBe('boom');
  });

  it('un fallo al destruir el documento no altera el resultado', async () => {
    givenPdf(['texto']);
    destroy.mockRejectedValue(new Error('destroy'));

    await expect(run()).resolves.toBe('texto');
  });
});
