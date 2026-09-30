import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth.service';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let auth: { token: jasmine.Spy; logout: jasmine.Spy };

  beforeEach(() => {
    auth = { token: jasmine.createSpy('token').and.returnValue('jwt-1'), logout: jasmine.createSpy('logout') };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  it('añade Authorization: Bearer a las llamadas al backend', () => {
    http.get(`${environment.apiUrl}/documents`).subscribe();

    const request = controller.expectOne(`${environment.apiUrl}/documents`);
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-1');
    request.flush([]);
  });

  it('no añade cabecera si no hay token', () => {
    auth.token.and.returnValue(null);

    http.get(`${environment.apiUrl}/documents`).subscribe();

    const request = controller.expectOne(`${environment.apiUrl}/documents`);
    expect(request.request.headers.has('Authorization')).toBeFalse();
    request.flush([]);
  });

  it('no envía el token a otros orígenes', () => {
    http.get('https://terceros.example.com/api').subscribe();

    const request = controller.expectOne('https://terceros.example.com/api');
    expect(request.request.headers.has('Authorization')).toBeFalse();
    request.flush({});
  });

  it('cierra la sesión ante un 401 y reenvía el error', () => {
    let status: number | undefined;

    http.get(`${environment.apiUrl}/documents`).subscribe({ error: (e) => (status = e.status) });
    controller
      .expectOne(`${environment.apiUrl}/documents`)
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(status).toBe(401);
  });

  it('no cierra la sesión ante otros errores', () => {
    http.get(`${environment.apiUrl}/documents`).subscribe({ error: () => undefined });
    controller
      .expectOne(`${environment.apiUrl}/documents`)
      .flush({}, { status: 500, statusText: 'Server Error' });

    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('deja que el flujo de auth gestione sus propios 401 (login, register, check-token)', () => {
    for (const path of ['login', 'register', 'check-token']) {
      http.get(`${environment.apiUrl}/auth/${path}`).subscribe({ error: () => undefined });
      controller
        .expectOne(`${environment.apiUrl}/auth/${path}`)
        .flush({}, { status: 401, statusText: 'Unauthorized' });
    }

    expect(auth.logout).not.toHaveBeenCalled();
  });
});
