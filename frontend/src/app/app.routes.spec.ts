import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { AuthStatus } from './auth/interfaces/auth-status.enum';
import { AuthService } from './auth/services/auth.service';

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

    expect(pageText()).toContain('Hola, Ada');
  });

  it('con sesión activa, /auth/login redirige a la ruta privada', async () => {
    restoreSession();

    await harness.navigateByUrl('/auth/login');

    expect(pageText()).toContain('Hola, Ada');
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

  it('la home enlaza a la pantalla de carga', async () => {
    restoreSession();

    await harness.navigateByUrl('/');

    const link = harness.routeNativeElement?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/documents/upload');
  });

  it('SPEC-10 AC-02: sin sesión, /search redirige a /auth/login', async () => {
    auth.checkAuthStatus().subscribe();

    await harness.navigateByUrl('/search');

    expect(pageText()).toContain('Iniciar sesión');
  });

  it('SPEC-10 AC-01: con sesión, /search muestra la pantalla de búsqueda sin término', async () => {
    restoreSession();

    await harness.navigateByUrl('/search');

    expect(pageText()).toContain('Buscar documentos');
    expect(pageText()).toContain('Búsqueda de documentación técnica');
    expect(harness.routeNativeElement?.querySelector<HTMLInputElement>('#search-term')?.value).toBe('');
  });

  it('SPEC-10: /search?q=... consulta y muestra resultados del mock', async () => {
    restoreSession();
    jasmine.clock().install();
    try {
      await harness.navigateByUrl('/search?q=kubernetes');
      expect(harness.routeNativeElement?.querySelectorAll('.skeleton').length).toBe(5);

      jasmine.clock().tick(1000);
      harness.detectChanges();

      expect(pageText()).toContain('12 resultados para «kubernetes»');
      expect(harness.routeNativeElement?.querySelectorAll('app-search-result-card').length).toBe(10);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('la home enlaza a la pantalla de búsqueda', async () => {
    restoreSession();

    await harness.navigateByUrl('/');

    const hrefs = Array.from(harness.routeNativeElement?.querySelectorAll('a') ?? []).map((link) => link.getAttribute('href'));
    expect(hrefs).toContain('/search');
  });

  it('una URL desconocida termina en login si no hay sesión', async () => {
    auth.checkAuthStatus().subscribe();

    await harness.navigateByUrl('/no-existe');

    expect(pageText()).toContain('Iniciar sesión');
  });
});
