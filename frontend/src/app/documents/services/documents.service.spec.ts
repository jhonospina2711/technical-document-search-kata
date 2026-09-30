import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { DocumentDetail, DocumentMetadata } from '../interfaces/document.interfaces';
import { DocumentLoadFailure, DocumentsService, UploadEvent, UploadFailure } from './documents.service';

const URL = `${environment.apiUrl}/documents`;

const metadata: DocumentMetadata = {
  title: '  Bomba P-101 ',
  author: 'Ing. Mendoza',
  category: 'Especificación de Ingeniería (ENG-SPEC)',
  version: '1.0.0',
  tags: [' api ', 'rest'],
};

describe('DocumentsService', () => {
  let service: DocumentsService;
  let controller: HttpTestingController;
  const file = new File(['contenido'], 'spec.md', { type: 'text/markdown' });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(DocumentsService);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  function fail(status: number, body: object | null = null): UploadFailure {
    let failure!: UploadFailure;
    service.upload(file, metadata).subscribe({ error: (error: UploadFailure) => (failure = error) });
    controller.expectOne(URL).flush(body, { status, statusText: 'x' });
    return failure;
  }

  it('envía multipart con file y los campos exactos, con valores recortados y tags unidos por coma', () => {
    service.upload(file, metadata).subscribe();

    const request = controller.expectOne(URL);
    expect(request.request.method).toBe('POST');
    const body = request.request.body as FormData;
    expect(body instanceof FormData).toBeTrue();
    expect([...body.keys()].sort()).toEqual(['author', 'category', 'file', 'tags', 'title', 'version']);
    expect((body.get('file') as File).name).toBe('spec.md');
    expect(body.get('title')).toBe('Bomba P-101');
    expect(body.get('author')).toBe('Ing. Mendoza');
    expect(body.get('category')).toBe('Especificación de Ingeniería (ENG-SPEC)');
    expect(body.get('version')).toBe('1.0.0');
    expect(body.get('tags')).toBe('api,rest');
    expect(request.request.reportProgress).toBeTrue();
    request.flush({ id: 'x', status: 'PROCESANDO' });
  });

  it('envía tags vacío cuando no hay etiquetas', () => {
    service.upload(file, { ...metadata, tags: [] }).subscribe();

    const request = controller.expectOne(URL);
    expect((request.request.body as FormData).get('tags')).toBe('');
    request.flush({ id: 'x', status: 'PROCESANDO' });
  });

  it('emite el progreso de subida y luego el documento creado', () => {
    const events: UploadEvent[] = [];
    service.upload(file, metadata).subscribe((event) => events.push(event));

    const request = controller.expectOne(URL);
    request.event({ type: 1 /* UploadProgress */, loaded: 25, total: 100 } as never);
    request.event({ type: 1, loaded: 100, total: 100 } as never);
    request.flush({ id: 'doc-1', status: 'PROCESANDO' });

    expect(events).toEqual([
      { type: 'progress', percent: 25, loaded: 25, total: 100 },
      { type: 'progress', percent: 100, loaded: 100, total: 100 },
      { type: 'done', document: { id: 'doc-1', status: 'PROCESANDO' } },
    ]);
  });

  it('informa 0 % si el navegador no conoce el total', () => {
    const events: UploadEvent[] = [];
    service.upload(file, metadata).subscribe((event) => events.push(event));

    const request = controller.expectOne(URL);
    request.event({ type: 1, loaded: 10 } as never);
    request.flush({ id: 'doc-1', status: 'PROCESANDO' });

    expect(events[0]).toEqual({ type: 'progress', percent: 0, loaded: 10, total: 0 });
  });

  it('trata una respuesta 202 sin id como error de servidor', () => {
    expect(fail(202, {}).kind).toBe('server');
  });

  it('400 con mensaje de texto es un rechazo del archivo, con el mensaje de la API', () => {
    expect(fail(400, { message: 'El archivo está vacío' })).toEqual({
      kind: 'file',
      message: 'El archivo está vacío',
      retryable: false,
    });
  });

  it('400 con lista de mensajes es un fallo de campos', () => {
    expect(fail(400, { message: ['title should not be empty', 'version should not be empty'] })).toEqual({
      kind: 'fields',
      message: 'title should not be empty. version should not be empty',
      retryable: false,
    });
  });

  it('400 sin cuerpo usa un mensaje genérico', () => {
    expect(fail(400).message).toBe('La solicitud no es válida');
  });

  it('413 usa el mensaje de la API y, sin cuerpo, el límite configurado', () => {
    expect(fail(413, { message: 'El archivo supera el tamaño máximo permitido (5 MB)' }).message).toBe(
      'El archivo supera el tamaño máximo permitido (5 MB)',
    );
    expect(fail(413)).toEqual({
      kind: 'file',
      message: 'El archivo supera el tamaño máximo permitido (10 MB)',
      retryable: false,
    });
  });

  it('401 se clasifica como sesión expirada, no reintentable', () => {
    expect(fail(401)).toEqual({
      kind: 'unauthorized',
      message: 'Tu sesión expiró. Inicia sesión de nuevo',
      retryable: false,
    });
  });

  it('503 es un error de servidor reintentable con mensaje específico', () => {
    const failure = fail(503, { message: 'detalle interno' });
    expect(failure.kind).toBe('server');
    expect(failure.retryable).toBeTrue();
    expect(failure.message).toBe('El servicio no pudo registrar el documento. Reintenta en unos segundos');
  });

  it('500 es un error de servidor reintentable con mensaje genérico', () => {
    const failure = fail(500, { message: 'Internal error' });
    expect(failure).toEqual({
      kind: 'server',
      message: 'No se pudo completar la carga. Inténtalo de nuevo',
      retryable: true,
    });
  });

  it('un error de red (status 0) es reintentable', () => {
    let failure!: UploadFailure;
    service.upload(file, metadata).subscribe({ error: (error: UploadFailure) => (failure = error) });
    controller.expectOne(URL).error(new ProgressEvent('error'), { status: 0 });

    expect(failure.kind).toBe('server');
    expect(failure.retryable).toBeTrue();
    expect(failure.message).toContain('No se pudo conectar con el servidor');
  });

  describe('getById', () => {
    const ID = 'e4b291a0-7f28-4c89-9a2d-b31057e93f61';
    const detail: DocumentDetail = {
      id: ID,
      title: 'Manual',
      author: 'Ing. Mendoza',
      category: 'Redes',
      tags: [],
      version: '1.0.0',
      fileName: 'manual.pdf',
      fileFormat: 'PDF',
      status: 'PROCESADO',
      content: 'texto',
      createdAt: '2024-10-14T09:30:00.000Z',
      updatedAt: '2024-10-22T16:45:00.000Z',
    };

    function load(id = ID): { result?: DocumentDetail; failure?: DocumentLoadFailure } {
      const out: { result?: DocumentDetail; failure?: DocumentLoadFailure } = {};
      service.getById(id).subscribe({
        next: (doc) => (out.result = doc),
        error: (error: DocumentLoadFailure) => (out.failure = error),
      });
      return out;
    }

    it('hace GET a /documents/:id con el id codificado y devuelve el detalle', () => {
      const out = load('a/b c');

      const request = controller.expectOne(`${URL}/a%2Fb%20c`);
      expect(request.request.method).toBe('GET');
      request.flush(detail);

      expect(out.result).toEqual(detail);
    });

    it('acepta un documento PROCESANDO con content null', () => {
      const out = load();
      controller.expectOne(`${URL}/${ID}`).flush({ ...detail, status: 'PROCESANDO', content: null });

      expect(out.result?.content).toBeNull();
    });

    it('404 y 400 se clasifican como no encontrado, no reintentable', () => {
      for (const status of [404, 400]) {
        const out = load();
        controller.expectOne(`${URL}/${ID}`).flush({ message: 'detalle interno' }, { status, statusText: 'x' });

        expect(out.failure).toEqual({ kind: 'not-found', message: 'Documento no encontrado', retryable: false });
      }
    });

    it('401 se clasifica como sesión expirada, no reintentable', () => {
      const out = load();
      controller.expectOne(`${URL}/${ID}`).flush(null, { status: 401, statusText: 'x' });

      expect(out.failure).toEqual({
        kind: 'unauthorized',
        message: 'Tu sesión expiró. Inicia sesión de nuevo',
        retryable: false,
      });
    });

    it('5xx es un error de servidor reintentable con mensaje genérico', () => {
      const out = load();
      controller.expectOne(`${URL}/${ID}`).flush({ message: 'Internal error' }, { status: 500, statusText: 'x' });

      expect(out.failure).toEqual({
        kind: 'server',
        message: 'No se pudo cargar el documento. Inténtalo de nuevo',
        retryable: true,
      });
    });

    it('un error de red (status 0) es reintentable', () => {
      const out = load();
      controller.expectOne(`${URL}/${ID}`).error(new ProgressEvent('error'), { status: 0 });

      expect(out.failure?.kind).toBe('server');
      expect(out.failure?.retryable).toBeTrue();
    });

    it('una respuesta con forma inválida es un error de servidor', () => {
      const invalid: Array<object | null> = [
        null,
        {},
        { ...detail, id: '' },
        { ...detail, status: 'DESCONOCIDO' },
        { ...detail, tags: null },
      ];
      for (const body of invalid) {
        const out = load();
        controller.expectOne(`${URL}/${ID}`).flush(body);

        expect(out.failure?.kind).toBe('server');
      }
    });
  });
});
