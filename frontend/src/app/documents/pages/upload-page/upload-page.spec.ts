import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { DocumentStatusTracker, TrackedStatus } from '../../services/document-status-tracker';
import { FileDropzone } from '../../components/file-dropzone/file-dropzone';
import { DOCUMENT_CATEGORIES } from '../../constants/document-categories';
import { DocumentsService, UploadEvent, UploadFailure } from '../../services/documents.service';
import { UploadPage } from './upload-page';

describe('UploadPage', () => {
  let fixture: ComponentFixture<UploadPage>;
  let host: HTMLElement;
  let upload$: Subject<UploadEvent>;
  let documents: { upload: jasmine.Spy };
  let router: Router;
  let tracker: { track: jasmine.Spy };
  let tracked: Subject<TrackedStatus>[];

  const text = () => host.textContent!.replace(/\s+/g, ' ');
  const query = <T extends HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  const submitButton = () => query<HTMLButtonElement>('button[type=submit]');
  const dropzone = () => fixture.debugElement.query(By.directive(FileDropzone)).componentInstance as FileDropzone;

  function type(selector: string, value: string): void {
    const element = query<HTMLInputElement>(selector);
    element.value = value;
    element.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function blur(selector: string): void {
    query(selector).dispatchEvent(new Event('blur'));
    fixture.detectChanges();
  }

  function pick(file: File): void {
    dropzone().filesSelected.emit([file]);
    fixture.detectChanges();
  }

  function fillValid(): void {
    type('#doc-title', 'Bomba P-101');
    type('#doc-author', 'Ing. Mendoza');
    const category = query<HTMLSelectElement>('#doc-category');
    category.value = DOCUMENT_CATEGORIES[0];
    category.dispatchEvent(new Event('change'));
    type('#doc-version', '1.0.0');
    fixture.detectChanges();
  }

  function press(key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });
    query('#tag-input').dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  const chips = () => Array.from(host.querySelectorAll('.chip')).map((chip) => chip.textContent!.trim());
  const validFile = () => new File(['contenido'], 'spec.md');

  function readyToSubmit(): File {
    const file = validFile();
    fillValid();
    pick(file);
    return file;
  }

  beforeEach(() => {
    upload$ = new Subject<UploadEvent>();
    documents = { upload: jasmine.createSpy('upload').and.callFake(() => upload$) };
    tracked = [];
    tracker = {
      track: jasmine.createSpy('track').and.callFake(() => {
        const updates = new Subject<TrackedStatus>();
        tracked.push(updates);
        return updates;
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: DocumentsService, useValue: documents },
        { provide: DocumentStatusTracker, useValue: tracker },
      ],
    });
    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(UploadPage);
    host = fixture.nativeElement;
    fixture.detectChanges();
  });

  describe('vista y archivo', () => {
    it('muestra el estado vacío con el envío deshabilitado y el límite configurado', () => {
      expect(text()).toContain('Cargar documento');
      expect(text()).toContain('Sin adjuntar');
      expect(text()).toContain('Formatos autorizados: TXT, PDF o MD');
      expect(text()).toContain('Límite estricto: 10 MB');
      expect(submitButton().disabled).toBeTrue();
      expect(query('.back').getAttribute('href')).toBe('/');
    });

    it('ofrece la lista fija de categorías más el placeholder', () => {
      expect(host.querySelectorAll('#doc-category option').length).toBe(DOCUMENT_CATEGORIES.length + 1);
    });

    it('adjunta un archivo válido y lo indica', () => {
      pick(validFile());

      expect(text()).toContain('MD · 9 B');
      expect(text()).toContain('spec.md');
    });

    it('rechaza un archivo inválido con el banner, sin adjuntarlo', () => {
      pick(new File(['x'], 'plano.dwg'));

      expect(query('[role=alert]').textContent).toContain('Formato no soportado (.dwg detectado)');
      expect(text()).toContain('Error de archivo');
      expect(text()).not.toContain('plano.dwg ·');
    });

    it('conserva el archivo anterior si el nuevo se rechaza', () => {
      pick(validFile());

      pick(new File([], 'vacio.txt'));

      expect(query('[role=alert]').textContent).toContain('El archivo está vacío');
      expect(text()).toContain('spec.md');
    });

    it('rechaza más de un archivo', () => {
      dropzone().filesSelected.emit([validFile(), new File(['y'], 'b.txt')]);
      fixture.detectChanges();

      expect(query('[role=alert]').textContent).toContain('Solo se admite un archivo');
    });

    it('permite quitar el archivo y limpia el error de archivo', () => {
      pick(validFile());
      query<HTMLButtonElement>('.link-button--danger').click();
      fixture.detectChanges();

      expect(text()).toContain('Sin adjuntar');
      expect(host.querySelector('[role=alert]')).toBeNull();
    });

    it('muestra "Arrastrando…" mientras se arrastra un archivo', () => {
      dropzone().dragging.set(true);
      fixture.detectChanges();

      expect(text()).toContain('Arrastrando…');
    });

    it('cierra el banner de error de archivo', () => {
      pick(new File(['x'], 'plano.dwg'));

      query<HTMLButtonElement>('.banner__close').click();
      fixture.detectChanges();

      expect(host.querySelector('[role=alert]')).toBeNull();
    });
  });

  describe('formulario', () => {
    it('habilita el envío solo con archivo y campos obligatorios válidos', () => {
      fillValid();
      expect(submitButton().disabled).toBeTrue();

      pick(validFile());
      expect(submitButton().disabled).toBeFalse();

      type('#doc-version', '1.0');
      expect(submitButton().disabled).toBeTrue();
    });

    it('muestra los errores de campo tras perder el foco, con aria-invalid', () => {
      expect(host.querySelector('.field-error')).toBeNull();

      blur('#doc-title');
      blur('#doc-category');
      type('#doc-version', '1.0');
      blur('#doc-version');

      expect(query('#title-error').textContent).toContain('Este campo es obligatorio');
      expect(query('#doc-title').getAttribute('aria-invalid')).toBe('true');
      expect(query('#doc-title').getAttribute('aria-describedby')).toBe('title-error');
      expect(query('#category-error').textContent).toContain('Selecciona una categoría válida');
      expect(query('#version-error').textContent).toContain('MAJOR.MINOR.PATCH');
    });

    it('trata el texto de solo espacios como vacío y limita la longitud', () => {
      type('#doc-author', '   ');
      blur('#doc-author');
      expect(query('#author-error').textContent).toContain('Este campo es obligatorio');

      type('#doc-author', 'a'.repeat(121));
      expect(query('#author-error').textContent).toContain('Máximo 120 caracteres');
    });

    it('marca los campos como válidos al corregirlos', () => {
      blur('#doc-title');
      type('#doc-title', 'Bomba');

      expect(host.querySelector('#title-error')).toBeNull();
      expect(query('#doc-title').getAttribute('aria-invalid')).toBeNull();
    });
  });

  describe('tags', () => {
    it('añade con Enter y con coma sin enviar el formulario', () => {
      type('#tag-input', 'api');
      const enter = press('Enter');
      type('#tag-input', 'rest');
      press(',');

      expect(enter.defaultPrevented).toBeTrue();
      expect(chips()).toEqual(['api', 'rest']);
      expect(query<HTMLInputElement>('#tag-input').value).toBe('');
    });

    it('ignora duplicados y entradas vacías', () => {
      type('#tag-input', 'api');
      press('Enter');
      type('#tag-input', ' api ');
      press('Enter');
      press('Enter');

      expect(chips()).toEqual(['api']);
    });

    it('parte el texto pegado con comas en varios tags y deja el resto como borrador', () => {
      type('#tag-input', 'a, b,c,d');

      expect(chips()).toEqual(['a', 'b', 'c']);
      expect(query<HTMLInputElement>('#tag-input').value).toBe('d');
    });

    it('quita el último tag con Backspace solo si el borrador está vacío', () => {
      type('#tag-input', 'a,b,');
      type('#tag-input', 'x');
      press('Backspace');
      expect(chips()).toEqual(['a', 'b']);

      type('#tag-input', '');
      press('Backspace');
      expect(chips()).toEqual(['a']);
    });

    it('quita un tag con su botón accesible', () => {
      type('#tag-input', 'a,b,');

      expect(query('.chip__remove').getAttribute('aria-label')).toBe('Eliminar tag a');
      query<HTMLButtonElement>('.chip__remove').click();
      fixture.detectChanges();

      expect(chips()).toEqual(['b']);
    });

    it('confirma el borrador al perder el foco', () => {
      type('#tag-input', 'pendiente');
      blur('#tag-input');

      expect(chips()).toEqual(['pendiente']);
    });

    it('rechaza un tag demasiado largo conservando el borrador', () => {
      type('#tag-input', 'a'.repeat(41));
      press('Enter');

      expect(chips()).toEqual([]);
      expect(query('#tag-error').textContent).toContain('hasta 40 caracteres');
      expect(query<HTMLInputElement>('#tag-input').value.length).toBe(41);
    });

    it('rechaza más de 20 tags', () => {
      for (let i = 0; i < 20; i++) {
        type('#tag-input', `t${i}`);
        press('Enter');
      }
      type('#tag-input', 'extra');
      press('Enter');

      expect(chips().length).toBe(20);
      expect(query('#tag-error').textContent).toContain('Máximo 20 tags');

      query<HTMLButtonElement>('.chip__remove').click();
      fixture.detectChanges();
      expect(host.querySelector('#tag-error')).toBeNull();
    });
  });

  describe('envío', () => {
    it('envía el archivo y la metadata, incluido el borrador de tag pendiente', () => {
      const file = readyToSubmit();
      type('#tag-input', 'api,rest,');
      type('#tag-input', 'pendiente');

      submitButton().click();

      expect(documents.upload).toHaveBeenCalledOnceWith(file, {
        title: 'Bomba P-101',
        author: 'Ing. Mendoza',
        category: DOCUMENT_CATEGORIES[0],
        version: '1.0.0',
        tags: ['api', 'rest', 'pendiente'],
      });
    });

    it('bloquea el formulario y muestra el progreso mientras sube', () => {
      readyToSubmit();
      submitButton().click();
      fixture.detectChanges();

      expect(text()).toContain('Subiendo documento…');
      expect(text()).toContain('Cargando (0%)');
      expect(submitButton().disabled).toBeTrue();
      expect(query<HTMLInputElement>('#doc-title').disabled).toBeTrue();
      expect(query<HTMLInputElement>('#tag-input').disabled).toBeTrue();
      expect(query<HTMLButtonElement>('.button--secondary').disabled).toBeTrue();

      upload$.next({ type: 'progress', percent: 40, loaded: 4, total: 10 });
      fixture.detectChanges();
      expect(text()).toContain('Cargando (40%)');
      expect(query('[role=progressbar]').getAttribute('aria-valuenow')).toBe('40');
    });

    it('ignora un segundo envío mientras hay uno en curso', () => {
      readyToSubmit();
      submitButton().click();
      query<HTMLFormElement>('form').dispatchEvent(new Event('submit'));

      expect(documents.upload).toHaveBeenCalledTimes(1);
    });

    it('SPEC-16 AC-04: al recibir el documento muestra "Documento cargado", el archivo, el id y PROCESANDO, sin enlace al visor, y limpia el formulario', () => {
      readyToSubmit();
      type('#tag-input', 'api,');
      submitButton().click();

      upload$.next({ type: 'done', document: { id: 'doc-123', status: 'PROCESANDO' } });
      fixture.detectChanges();

      const banner = query('[role=status].banner');
      expect(banner.textContent).toContain('Documento cargado');
      expect(query('.banner__file').textContent).toBe('spec.md');
      expect(banner.textContent).toContain('Procesando documento…');
      expect(banner.textContent).toContain('El documento estará disponible cuando termine el procesamiento.');
      expect(banner.querySelector('.badge .spin')).not.toBeNull();
      expect(banner.querySelector('a')).toBeNull();
      expect(query('.banner code').textContent).toBe('doc-123');
      expect(query('.badge').textContent).toContain('PROCESANDO');
      expect(text()).toContain('Carga completada');
      expect(query<HTMLInputElement>('#doc-title').value).toBe('');
      expect(query<HTMLInputElement>('#doc-title').disabled).toBeFalse();
      expect(chips()).toEqual([]);
      expect(submitButton().disabled).toBeTrue();
      expect(host.querySelector('#title-error')).toBeNull();
    });

    it('cierra la confirmación', () => {
      readyToSubmit();
      submitButton().click();
      upload$.next({ type: 'done', document: { id: 'doc-1', status: 'PROCESANDO' } });
      fixture.detectChanges();

      query<HTMLButtonElement>('.banner--success .banner__close').click();
      fixture.detectChanges();

      expect(host.querySelector('.banner--success')).toBeNull();
    });

    it('un rechazo del archivo muestra el banner, conserva los datos y desbloquea', () => {
      readyToSubmit();
      submitButton().click();

      upload$.error({ kind: 'file', message: 'El archivo está vacío', retryable: false } as UploadFailure);
      fixture.detectChanges();

      expect(query('[role=alert]').textContent).toContain('El archivo está vacío');
      expect(query<HTMLInputElement>('#doc-title').value).toBe('Bomba P-101');
      expect(query<HTMLInputElement>('#doc-title').disabled).toBeFalse();
      expect(text()).toContain('spec.md');
      expect(submitButton().disabled).toBeFalse();
    });

    it('un fallo de validación de campos muestra el banner de revisión', () => {
      readyToSubmit();
      submitButton().click();

      upload$.error({ kind: 'fields', message: 'title should not be empty', retryable: false } as UploadFailure);
      fixture.detectChanges();

      expect(query('[role=alert]').textContent).toContain('Revisa los datos del formulario');
      expect(query('[role=alert]').textContent).toContain('title should not be empty');
    });

    it('un error de servidor permite reintentar con los mismos datos y descartar el aviso', () => {
      const file = readyToSubmit();
      submitButton().click();
      upload$.error({ kind: 'server', message: 'No se pudo completar', retryable: true } as UploadFailure);
      fixture.detectChanges();

      expect(query('[role=alert]').textContent).toContain('No se pudo completar la carga');
      expect(query('[role=alert]').textContent).toContain('Los datos del formulario se conservaron');

      upload$ = new Subject<UploadEvent>();
      query<HTMLButtonElement>('.button--danger').click();
      fixture.detectChanges();

      expect(documents.upload).toHaveBeenCalledTimes(2);
      expect(documents.upload.calls.mostRecent().args[0]).toBe(file);
      expect(host.querySelector('[role=alert]')).toBeNull();
    });

    it('no ofrece reintento si el fallo no es reintentable y permite descartarlo', () => {
      readyToSubmit();
      submitButton().click();
      upload$.error({ kind: 'server', message: 'x', retryable: false } as UploadFailure);
      fixture.detectChanges();

      expect(host.querySelector('.button--danger')).toBeNull();
      query<HTMLButtonElement>('[role=alert] .link-button').click();
      fixture.detectChanges();
      expect(host.querySelector('[role=alert]')).toBeNull();
    });

    it('ante un 401 desbloquea sin mostrar avisos (la sesión la cierra el interceptor)', () => {
      readyToSubmit();
      submitButton().click();

      upload$.error({ kind: 'unauthorized', message: 'Tu sesión expiró', retryable: false } as UploadFailure);
      fixture.detectChanges();

      expect(host.querySelector('[role=alert]')).toBeNull();
      expect(query<HTMLInputElement>('#doc-title').disabled).toBeFalse();
    });

    it('cancela la suscripción si la página se destruye durante la subida', () => {
      readyToSubmit();
      submitButton().click();
      expect(upload$.observed).toBeTrue();

      fixture.destroy();

      expect(upload$.observed).toBeFalse();
    });
  });

  describe('cancelar', () => {
    it('limpia el formulario y navega a la home', () => {
      const navigate = spyOn(router, 'navigateByUrl').and.resolveTo(true);
      readyToSubmit();
      type('#tag-input', 'api,');

      query<HTMLButtonElement>('.button--secondary').click();
      fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith('/');
      expect(query<HTMLInputElement>('#doc-title').value).toBe('');
      expect(chips()).toEqual([]);
      expect(text()).toContain('Sin adjuntar');
    });
  });

  describe('seguimiento en vivo del documento creado', () => {
    function uploadDocument(id = 'doc-123'): void {
      readyToSubmit();
      submitButton().click();
      upload$.next({ type: 'done', document: { id, status: 'PROCESANDO' } });
      fixture.detectChanges();
    }

    it('sigue el documento creado con el tracker y muestra la nota de reconexión mientras no hay conexión', () => {
      uploadDocument();

      expect(tracker.track).toHaveBeenCalledOnceWith('doc-123');
      tracked[0].next({ status: 'PROCESANDO', live: false });
      fixture.detectChanges();
      expect(text()).toContain('Reconectando con el servidor');

      tracked[0].next({ status: 'PROCESANDO', live: true });
      fixture.detectChanges();
      expect(text()).not.toContain('Reconectando');
      expect(query('.badge').textContent).toContain('PROCESANDO');
    });

    it('pasa a "Documento procesado" al recibir PROCESADO, sin refrescar (AC-01)', () => {
      uploadDocument();
      tracked[0].next({ status: 'PROCESADO', live: false });
      fixture.detectChanges();

      const banner = query('.banner--success');
      expect(banner.getAttribute('role')).toBe('status');
      expect(banner.textContent).toContain('Documento procesado');
      expect(banner.textContent).toContain('ya está indexado y disponible en la búsqueda');
      expect(query('.badge').textContent).toContain('PROCESADO');
      expect(query('.badge').classList).toContain('badge--done');
      expect(banner.querySelector('.spin')).toBeNull();
      expect(text()).not.toContain('Reconectando');
      expect(query('.banner code').textContent).toBe('doc-123');
      expect(query('.banner__file').textContent).toBe('spec.md');
    });

    it('SPEC-16 AC-05: con PROCESADO ofrece "Ver documento" hacia /documents/:id', () => {
      uploadDocument('doc/123');
      tracked[0].next({ status: 'PROCESADO', live: false });
      fixture.detectChanges();

      const link = query<HTMLAnchorElement>('.banner--success a');
      expect(link.textContent!.trim()).toBe('Ver documento');
      expect(link.getAttribute('href')).toBe('/documents/doc%2F123');
    });

    it('SPEC-16 AC-05: con ERROR no hay enlace al visor', () => {
      uploadDocument();
      tracked[0].next({ status: 'ERROR', live: false });
      fixture.detectChanges();

      expect(host.querySelector('.banner a')).toBeNull();
    });

    it('SPEC-16 FR-05: el nombre del archivo se muestra como texto literal', () => {
      pick(new File(['x'], '<b>informe</b>.txt'));
      fillValid();
      submitButton().click();
      upload$.next({ type: 'done', document: { id: 'doc-1', status: 'PROCESANDO' } });
      fixture.detectChanges();

      expect(query('.banner__file').textContent).toBe('<b>informe</b>.txt');
      expect(host.querySelector('.banner__file b')).toBeNull();
    });

    it('pasa al banner de error al recibir ERROR (AC-02)', () => {
      uploadDocument();
      tracked[0].next({ status: 'ERROR', live: false });
      fixture.detectChanges();

      const banner = query('.banner--error');
      expect(banner.getAttribute('role')).toBe('alert');
      expect(banner.textContent).toContain('No se pudo procesar el documento');
      expect(banner.textContent).toContain('PDF cifrado, dañado o sin texto');
      expect(query('.badge').textContent).toContain('ERROR');
      expect(host.querySelector('.banner--success')).toBeNull();
    });

    it('cerrar el banner cancela el seguimiento (AC-07)', () => {
      uploadDocument();
      expect(tracked[0].observed).toBeTrue();

      query<HTMLButtonElement>('.banner .banner__close').click();
      fixture.detectChanges();

      expect(tracked[0].observed).toBeFalse();
    });

    it('subir otro documento cancela el seguimiento anterior y empieza desde PROCESANDO (AC-07)', () => {
      uploadDocument('doc-1');
      tracked[0].next({ status: 'PROCESADO', live: false });
      fixture.detectChanges();

      upload$ = new Subject<UploadEvent>();
      readyToSubmit();
      submitButton().click();
      fixture.detectChanges();
      expect(tracked[0].observed).toBeFalse();

      upload$.next({ type: 'done', document: { id: 'doc-2', status: 'PROCESANDO' } });
      fixture.detectChanges();

      expect(tracker.track).toHaveBeenCalledWith('doc-2');
      expect(query('.badge').textContent).toContain('PROCESANDO');
      expect(query('.banner code').textContent).toBe('doc-2');
    });

    it('destruir la página cancela el seguimiento (AC-07)', () => {
      uploadDocument();
      fixture.destroy();

      expect(tracked[0].observed).toBeFalse();
    });

    it('un error del seguimiento deja el banner en PROCESANDO sin romper la página', () => {
      uploadDocument();
      tracked[0].error(new Error('Sin sesión activa'));
      fixture.detectChanges();

      expect(query('.badge').textContent).toContain('PROCESANDO');
    });
  });
});
