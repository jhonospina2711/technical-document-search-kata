import { Location, registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, Subject } from 'rxjs';
import { DocumentDetail } from '../../interfaces/document.interfaces';
import { DocumentLoadFailure, DocumentsService } from '../../services/documents.service';
import { DocumentViewerPage } from './document-viewer-page';

@Component({ template: '<p>búsqueda</p>' })
class SearchStub {}

interface Call {
  id: string;
  subject: Subject<DocumentDetail>;
}

/** Sustituye a `DocumentsService`: cada consulta queda pendiente hasta que el test la resuelva. */
class FakeDocumentsService {
  readonly calls: Call[] = [];

  getById(id: string): Observable<DocumentDetail> {
    const subject = new Subject<DocumentDetail>();
    this.calls.push({ id, subject });
    return subject.asObservable();
  }
}

const detail = (overrides: Partial<DocumentDetail> = {}): DocumentDetail => ({
  id: 'e4b291a0-7f28-4c89-9a2d-b31057e93f61',
  title: 'Manual de Redes',
  author: 'Ing. Carlos Mendoza',
  category: 'Infraestructura',
  tags: ['redes'],
  version: '2.4.1',
  fileName: 'manual.pdf',
  fileFormat: 'PDF',
  status: 'PROCESADO',
  content: 'Las redes de alta disponibilidad usan BGP.',
  createdAt: '2024-10-14T09:30:00.000Z',
  updatedAt: '2024-10-22T16:45:00.000Z',
  ...overrides,
});

const SERVER: DocumentLoadFailure = {
  kind: 'server',
  message: 'No se pudo cargar el documento. Inténtalo de nuevo',
  retryable: true,
};
const NOT_FOUND: DocumentLoadFailure = { kind: 'not-found', message: 'Documento no encontrado', retryable: false };
const UNAUTHORIZED: DocumentLoadFailure = { kind: 'unauthorized', message: 'Sesión expirada', retryable: false };

describe('DocumentViewerPage', () => {
  let fake: FakeDocumentsService;
  let harness: RouterTestingHarness;
  let host: HTMLElement;
  let writeText: jasmine.Spy;

  const text = () => host.textContent!.replace(/\s+/g, ' ');
  const last = () => fake.calls[fake.calls.length - 1];
  const marks = () => [...host.querySelectorAll('mark')].map((mark) => mark.textContent);
  const body = () => host.querySelector('.text')!.textContent;
  const button = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent!.includes(label))!;
  const microtasks = async () => {
    for (let i = 0; i < 4; i++) {
      await Promise.resolve();
    }
    harness.detectChanges();
  };

  const open = async (url: string) => {
    await harness.navigateByUrl(url);
    host = harness.routeNativeElement as HTMLElement;
    harness.detectChanges();
  };
  const respond = (document: DocumentDetail) => {
    last().subject.next(document);
    last().subject.complete();
    harness.detectChanges();
  };
  const fail = (failure: DocumentLoadFailure) => {
    last().subject.error(failure);
    harness.detectChanges();
  };

  beforeAll(() => registerLocaleData(localeEs));

  beforeEach(async () => {
    fake = new FakeDocumentsService();
    writeText = jasmine.createSpy('writeText').and.resolveTo();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'documents/:id', component: DocumentViewerPage },
          { path: 'search', component: SearchStub },
        ]),
        { provide: DocumentsService, useValue: fake },
      ],
    });
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    delete (navigator as unknown as Record<string, unknown>)['clipboard'];
  });

  describe('carga', () => {
    it('AC-04: muestra esqueletos con aria-busy mientras carga y los quita al responder', async () => {
      await open('/documents/abc');

      expect(fake.calls.map((call) => call.id)).toEqual(['abc']);
      expect(host.querySelector('.viewer')!.getAttribute('aria-busy')).toBe('true');
      expect(host.querySelectorAll('.skeleton__line').length).toBeGreaterThan(0);
      expect(host.querySelector('h1')).toBeNull();

      respond(detail());

      expect(host.querySelector('.viewer')!.getAttribute('aria-busy')).toBe('false');
      expect(host.querySelector('.skeleton')).toBeNull();
    });

    it('AC-01: un documento PROCESADO muestra cabecera, contenido, contadores y metadatos', async () => {
      await open('/documents/abc');
      respond(detail());

      expect(host.querySelector('h1')!.textContent).toBe('Manual de Redes');
      expect(host.querySelector('.badge--success')!.textContent).toContain('PROCESADO');
      expect(host.querySelector('.badge--format')!.textContent).toContain('PDF');
      expect(text()).toContain('Por Ing. Carlos Mendoza · Versión 2.4.1 · Creado el 14 oct 2024, 09:30 UTC');
      expect(body()).toBe('Las redes de alta disponibilidad usan BGP.');
      expect(text()).toContain('42 caracteres · 7 palabras');
      expect(host.querySelector('app-document-metadata-panel')).not.toBeNull();
      expect(host.querySelectorAll('h1').length).toBe(1);
    });

    it('separa los miles con punto en los contadores', async () => {
      await open('/documents/abc');
      respond(detail({ content: 'ab '.repeat(2410).trim() }));

      expect(text()).toContain('7.229 caracteres · 2.410 palabras');
    });

    it('un cambio solo de ?q= no repite la consulta', async () => {
      await open('/documents/abc?q=redes');
      respond(detail());

      await open('/documents/abc?q=bgp');

      expect(fake.calls.length).toBe(1);
      expect(marks()).toEqual(['BGP']);
    });

    it('AC-15: descarta la respuesta tardía de un id anterior', async () => {
      await open('/documents/a');
      const first = last();
      await open('/documents/b');

      last().subject.next(detail({ title: 'Documento B' }));
      first.subject.next(detail({ title: 'Documento A' }));
      harness.detectChanges();

      expect(fake.calls.map((call) => call.id)).toEqual(['a', 'b']);
      expect(host.querySelector('h1')!.textContent).toBe('Documento B');
    });
  });

  describe('estados del documento', () => {
    it('AC-05: PROCESANDO muestra el aviso, el esqueleto y "Actualizar", sin contenido ni barra de copiar', async () => {
      await open('/documents/abc');
      respond(detail({ status: 'PROCESANDO', content: null }));

      expect(host.querySelector('.badge--warning')!.textContent).toContain('PROCESANDO');
      expect(text()).toContain('El documento se está procesando.');
      expect(text()).toContain('El contenido estará disponible en unos momentos.');
      expect(button('Actualizar')).toBeTruthy();
      expect(host.querySelectorAll('.skeleton__line').length).toBeGreaterThan(0);
      expect(host.querySelector('.toolbar')).toBeNull();
      expect(host.querySelector('.text')).toBeNull();
      expect(host.querySelector('app-document-metadata-panel')).not.toBeNull();
    });

    it('AC-06: "Actualizar" conserva la vista, deshabilita el botón y luego muestra el contenido', async () => {
      await open('/documents/abc');
      respond(detail({ status: 'PROCESANDO', content: null }));

      button('Actualizar').click();
      harness.detectChanges();

      expect(fake.calls.length).toBe(2);
      expect(host.querySelector('h1')!.textContent).toBe('Manual de Redes');
      const busy = button('Actualizando');
      expect(busy.disabled).toBeTrue();
      expect(busy.getAttribute('aria-busy')).toBe('true');

      respond(detail({ content: 'Contenido listo' }));

      expect(host.querySelector('.badge--success')).not.toBeNull();
      expect(body()).toBe('Contenido listo');
    });

    it('no lanza consultas duplicadas mientras se actualiza', async () => {
      await open('/documents/abc');
      respond(detail({ status: 'PROCESANDO', content: null }));

      const refresh = button('Actualizar');
      refresh.click();
      refresh.click();

      expect(fake.calls.length).toBe(2);
    });

    it('si falla "Actualizar" conserva lo mostrado y lo anuncia', async () => {
      await open('/documents/abc');
      respond(detail({ status: 'PROCESANDO', content: null }));

      button('Actualizar').click();
      fail(SERVER);

      expect(host.querySelector('h1')!.textContent).toBe('Manual de Redes');
      expect(button('Actualizar').disabled).toBeFalse();
      expect(host.querySelector('[aria-live="polite"].feedback')!.textContent).toBe('No se pudo actualizar');
    });

    it('si "Actualizar" responde 404 pasa a "no encontrado"', async () => {
      await open('/documents/abc');
      respond(detail({ status: 'PROCESANDO', content: null }));

      button('Actualizar').click();
      fail(NOT_FOUND);

      expect(host.querySelector('h1')!.textContent).toBe('Documento no encontrado');
    });

    it('AC-07: ERROR muestra el mensaje genérico sin reintento y con los metadatos', async () => {
      await open('/documents/abc');
      respond(detail({ status: 'ERROR', content: null }));

      const alert = host.querySelector('.notice--danger[role="alert"]')!;
      expect(alert.textContent).toContain('No se pudo procesar el documento.');
      expect(host.querySelector('.badge--danger')!.textContent).toContain('ERROR');
      expect(host.querySelector('.card button')).toBeNull();
      expect(host.querySelector('app-document-metadata-panel')).not.toBeNull();
    });

    it('PROCESADO sin contenido muestra "sin contenido disponible" y deshabilita copiar', async () => {
      await open('/documents/abc');
      respond(detail({ content: null }));

      expect(text()).toContain('El documento no tiene contenido disponible');
      expect(button('Copiar contenido').disabled).toBeTrue();
      expect(host.querySelector('.text')).toBeNull();
      expect(text()).toContain('0 caracteres · 0 palabras');
    });
  });

  describe('fallos de carga', () => {
    it('AC-08: 404/400 muestran "Documento no encontrado" sin cabecera ni metadatos', async () => {
      await open('/documents/abc');
      fail(NOT_FOUND);

      expect(host.querySelector('h1')!.textContent).toBe('Documento no encontrado');
      const link = host.querySelector<HTMLAnchorElement>('a.button')!;
      expect(link.textContent).toContain('Volver a la búsqueda');
      expect(link.getAttribute('href')).toBe('/search');
      expect(host.querySelector('app-document-metadata-panel')).toBeNull();
      expect(host.querySelector('.header')).toBeNull();
    });

    it('AC-09: un fallo de servidor muestra el banner genérico y "Reintentar" repite la consulta', async () => {
      await open('/documents/abc');
      fail(SERVER);

      const banner = host.querySelector('.banner[role="alert"]')!;
      expect(banner.textContent).toContain('No se pudo cargar el documento');
      expect(banner.textContent).not.toMatch(/\b5\d\d\b/);

      button('Reintentar').click();
      harness.detectChanges();
      expect(fake.calls.length).toBe(2);
      expect(host.querySelector('.banner')).toBeNull();
      expect(host.querySelector('.viewer')!.getAttribute('aria-busy')).toBe('true');

      respond(detail());
      expect(host.querySelector('h1')!.textContent).toBe('Manual de Redes');
    });

    it('un 401 no muestra mensaje propio (lo gestiona el interceptor)', async () => {
      await open('/documents/abc');
      fail(UNAUTHORIZED);

      expect(host.querySelector('.banner')).toBeNull();
      expect(host.querySelector('.panel')).toBeNull();
    });
  });

  describe('resaltado', () => {
    it('AC-10: resalta solo las coincidencias de ?q=, sin distinguir mayúsculas', async () => {
      await open('/documents/abc?q=REDES bgp');
      respond(detail());

      expect(marks()).toEqual(['redes', 'BGP']);
      expect(body()).toBe('Las redes de alta disponibilidad usan BGP.');
    });

    it('AC-11: muestra el HTML del contenido como texto y trata q como literal', async () => {
      const content = '<script>alert(1)</script> <b>negrita</b> a.*b &amp;';
      // En una query string el `+` es un espacio: q se separa en `.*`, `?()[]` y `<b>negrita</b>`.
      await open('/documents/abc?q=.*+?()[] <b>negrita</b>');
      respond(detail({ content }));

      expect(body()).toBe(content);
      expect(host.querySelector('.text script')).toBeNull();
      expect(host.querySelector('.text b')).toBeNull();
      expect(marks()).toEqual(['<b>negrita</b>', '.*']);
    });

    it('AC-12: sin q, con q vacío o sin coincidencias no hay marcas', async () => {
      for (const url of ['/documents/a', '/documents/b?q=', '/documents/c?q=zzz']) {
        await open(url);
        respond(detail());

        expect(marks()).toEqual([]);
        expect(body()).toBe('Las redes de alta disponibilidad usan BGP.');
      }
    });
  });

  describe('copiar', () => {
    it('AC-13: copia el contenido original sin marcas y anuncia "Copiado" durante 2 s', async () => {
      await open('/documents/abc?q=redes');
      respond(detail());
      jasmine.clock().install();

      button('Copiar contenido').click();
      await microtasks();

      expect(writeText).toHaveBeenCalledOnceWith('Las redes de alta disponibilidad usan BGP.');
      expect(host.querySelector('.toolbar .feedback')!.textContent).toBe('Copiado');

      jasmine.clock().tick(2000);
      harness.detectChanges();
      expect(host.querySelector('.toolbar .feedback')!.textContent).toBe('');
    });

    it('AC-13: si el portapapeles falla muestra "No se pudo copiar"', async () => {
      writeText.and.rejectWith(new Error('denegado'));
      await open('/documents/abc');
      respond(detail());

      button('Copiar contenido').click();
      await microtasks();

      expect(host.querySelector('.toolbar .feedback')!.textContent).toBe('No se pudo copiar');
    });

    it('sin navigator.clipboard muestra "No se pudo copiar"', async () => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      await open('/documents/abc');
      respond(detail());

      button('Copiar contenido').click();
      await microtasks();

      expect(host.querySelector('.toolbar .feedback')!.textContent).toBe('No se pudo copiar');
    });

    it('copia el ID desde el panel de metadatos y lo anuncia allí', async () => {
      await open('/documents/abc');
      respond(detail());

      host.querySelector<HTMLButtonElement>('button[aria-label="Copiar ID del documento"]')!.click();
      await microtasks();

      expect(writeText).toHaveBeenCalledOnceWith('e4b291a0-7f28-4c89-9a2d-b31057e93f61');
      expect(host.querySelector('app-document-metadata-panel .feedback')!.textContent).toBe('Copiado');
    });
  });

  describe('volver a resultados', () => {
    it('AC-16: el enlace apunta a /search con q y, sin historial, navega ahí', async () => {
      await open('/documents/abc?q=redes');
      respond(detail());
      const back = host.querySelector<HTMLAnchorElement>('.crumbs__back')!;
      const router = TestBed.inject(Router);

      expect(back.getAttribute('href')).toBe('/search?q=redes');
      back.click();
      await harness.fixture.whenStable();

      expect(router.url).toBe('/search?q=redes');
    });

    it('sin q el enlace apunta a /search', async () => {
      await open('/documents/abc');
      respond(detail());

      expect(host.querySelector('.crumbs__back')!.getAttribute('href')).toBe('/search');
    });

    it('AC-16: con navegación previa dentro de la app usa el historial', async () => {
      await harness.navigateByUrl('/search?q=x&page=2');
      const location = TestBed.inject(Location);
      const back = spyOn(location, 'back');
      await open('/documents/abc?q=x');
      respond(detail());
      const router = TestBed.inject(Router);

      host.querySelector<HTMLAnchorElement>('.crumbs__back')!.click();
      await harness.fixture.whenStable();

      expect(back).toHaveBeenCalledTimes(1);
      expect(router.url).toBe('/documents/abc?q=x');
    });
  });
});
