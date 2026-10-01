import { registerLocaleData } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import localeEs from '@angular/common/locales/es';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { AuthStatus } from './auth/interfaces/auth-status.enum';
import { AuthService } from './auth/services/auth.service';

const DOCUMENT_ID = 'e4b291a0-7f28-4c89-9a2d-b31057e93f61';

describe('rutas y guards', () => {
  let harness: RouterTestingHarness;
  let auth: AuthService;

  const pageText = () => harness.routeNativeElement?.textContent ?? '';

  /** Simula el arranque: la app resuelve la sesión antes de la primera navegación. */
  function restoreSession() {
    localStorage.setItem('token', 'jwt-1');
    auth.checkAuthStatus().subscribe();
    TestBed.inject(HttpTestingController)
      .expectOne(`${environment.apiUrl}/auth/check-token`)
      .flush({
        token: 'jwt-2',
        user: { id: 'u1', email: 'ada@example.com', name: 'Ada', isActive: true, roles: ['user'] },
      });
    expect(auth.authStatus()).toBe(AuthStatus.Authenticated);
  }

  beforeAll(() => registerLocaleData(localeEs));

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthService);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => localStorage.clear());

  it('AC-09: sin sesión, una ruta privada redirige a /auth/login', async () => {
    auth.checkAuthStatus().subscribe();

    await harness.navigateByUrl('/');

    expect(pageText()).toContain('Iniciar sesión');
  });

  it('sin sesión, /auth/register es accesible', async () => {
    auth.checkAuthStatus().subscribe();

    await harness.navigateByUrl('/auth/register');

    expect(pageText()).toContain('Crear cuenta');
  });

  it('AC-08: con token guardado se restaura la sesión y se accede a la ruta privada', async () => {
    restoreSession();

    await harness.navigateByUrl('/');

    expect(pageText()).toContain('Buscar documentos');
  });

  it('con sesión activa, /auth/login redirige a la ruta privada', async () => {
    restoreSession();

    await harness.navigateByUrl('/auth/login');

    expect(TestBed.inject(Router).url).toBe('/');
    expect(pageText()).toContain('Buscar documentos');
  });

  it('SPEC-16 AC-01: con sesión, / muestra el buscador sin término dentro del shell', async () => {
    restoreSession();

    await harness.navigateByUrl('/');

    expect(pageText()).toContain('Búsqueda de documentación técnica');
    expect(harness.routeNativeElement?.querySelector<HTMLInputElement>('#search-term')?.value).toBe('');
    const shell = harness.fixture.nativeElement as HTMLElement;
    expect(shell.querySelector('app-shell .brand')?.textContent).toContain('Documentos técnicos');
    expect(shell.textContent).toContain('+ Cargar');
    expect(shell.textContent).toContain('Ada');
    expect(shell.textContent).toContain('Cerrar sesión');
    expect(shell.textContent).not.toContain('Hola, Ada');
  });

  it('SPEC-16 AC-02: /search redirige a / conservando q, sort y page', async () => {
    restoreSession();

    await harness.navigateByUrl('/search?q=rabbit&sort=date-desc&page=2');

    expect(TestBed.inject(Router).url).toBe('/?q=rabbit&sort=date-desc&page=2');
    expect(harness.routeNativeElement?.querySelector<HTMLInputElement>('#search-term')?.value).toBe('rabbit');
  });

  it('SPEC-16 AC-06: sin sesión, /search redirige a /auth/login', async () => {
    auth.checkAuthStatus().subscribe();

    await harness.navigateByUrl('/search?q=rabbit');

    expect(pageText()).toContain('Iniciar sesión');
  });

  it('AC-02: sin sesión, /documents/upload redirige a /auth/login', async () => {
    auth.checkAuthStatus().subscribe();

    await harness.navigateByUrl('/documents/upload');

    expect(pageText()).toContain('Iniciar sesión');
  });

  it('AC-01: con sesión, /documents/upload muestra la pantalla de carga', async () => {
    restoreSession();

    await harness.navigateByUrl('/documents/upload');

    expect(pageText()).toContain('Cargar documento');
    expect(pageText()).toContain('Sin adjuntar');
  });

  it('SPEC-11 AC-02: sin sesión, /documents/:id redirige a /auth/login', async () => {
    auth.checkAuthStatus().subscribe();

    await harness.navigateByUrl(`/documents/${DOCUMENT_ID}`);

    expect(pageText()).toContain('Iniciar sesión');
    TestBed.inject(HttpTestingController).expectNone(`${environment.apiUrl}/documents/${DOCUMENT_ID}`);
  });

  it('SPEC-11 AC-01: con sesión, /documents/:id consulta el documento y muestra el visor', async () => {
    restoreSession();

    await harness.navigateByUrl(`/documents/${DOCUMENT_ID}?q=redes`);
    TestBed.inject(HttpTestingController)
      .expectOne(`${environment.apiUrl}/documents/${DOCUMENT_ID}`)
      .flush({
        id: DOCUMENT_ID,
        title: 'Manual de Redes',
        author: 'Ing. Mendoza',
        category: 'Infraestructura',
        tags: [],
        version: '1.0.0',
        fileName: 'manual.txt',
        fileFormat: 'TXT',
        status: 'PROCESADO',
        content: 'Las redes de alta disponibilidad',
        createdAt: '2024-10-14T09:30:00.000Z',
        updatedAt: '2024-10-14T09:30:00.000Z',
      });
    harness.detectChanges();

    expect(pageText()).toContain('Manual de Redes');
    expect(pageText()).toContain('Volver a resultados');
    expect(harness.routeNativeElement?.querySelector('mark')?.textContent).toBe('redes');
  });

  it('SPEC-11 AC-03: /documents/upload sigue mostrando la carga y no se interpreta como un id', async () => {
    restoreSession();

    await harness.navigateByUrl('/documents/upload');

    expect(pageText()).toContain('Sin adjuntar');
    TestBed.inject(HttpTestingController).expectNone(`${environment.apiUrl}/documents/upload`);
  });

  it('SPEC-10: /?q=... consulta y muestra resultados del mock', async () => {
    const originalMockFlag = environment.useMockSearch;
    environment.useMockSearch = true;
    try {
      restoreSession();
      jasmine.clock().install();
      await harness.navigateByUrl('/?q=kubernetes');
      expect(harness.routeNativeElement?.querySelectorAll('.skeleton').length).toBe(5);

      jasmine.clock().tick(1000);
      harness.detectChanges();

      expect(pageText()).toContain('12 resultados para «kubernetes»');
      expect(harness.routeNativeElement?.querySelectorAll('app-search-result-card').length).toBe(10);
    } finally {
      jasmine.clock().uninstall();
      environment.useMockSearch = originalMockFlag;
    }
  });

  it('una URL desconocida termina en login si no hay sesión', async () => {
    auth.checkAuthStatus().subscribe();

    await harness.navigateByUrl('/no-existe');

    expect(pageText()).toContain('Iniciar sesión');
  });
});
