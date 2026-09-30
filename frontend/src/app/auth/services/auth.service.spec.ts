import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthStatus } from '../interfaces/auth-status.enum';
import { AuthSession } from '../interfaces/user.interface';
import { AuthService } from './auth.service';

const api = `${environment.apiUrl}/auth`;
const session: AuthSession = {
  token: 'jwt-1',
  user: { id: 'u1', email: 'ada@example.com', name: 'Ada', isActive: true, roles: ['user'] },
};

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;
  let navigateByUrl: jasmine.Spy;

  function setup() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    navigateByUrl = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('empieza en estado "checking" sin usuario', () => {
    setup();

    expect(service.authStatus()).toBe(AuthStatus.Checking);
    expect(service.currentUser()).toBeNull();
  });

  describe('login', () => {
    it('guarda el token y publica usuario y estado', () => {
      setup();
      let completed = false;

      service.login('ada@example.com', 'secret1').subscribe(() => (completed = true));
      const request = http.expectOne(`${api}/login`);
      expect(request.request.body).toEqual({ email: 'ada@example.com', password: 'secret1' });
      request.flush(session);

      expect(completed).toBeTrue();
      expect(localStorage.getItem('token')).toBe('jwt-1');
      expect(service.currentUser()).toEqual(session.user);
      expect(service.authStatus()).toBe(AuthStatus.Authenticated);
    });

    it('propaga el mensaje del backend y no guarda nada', () => {
      setup();
      let message = '';

      service.login('ada@example.com', 'mala1234').subscribe({ error: (m: string) => (message = m) });
      http.expectOne(`${api}/login`).flush({ message: 'Credenciales inválidas' }, { status: 401, statusText: 'Unauthorized' });

      expect(message).toBe('Credenciales inválidas');
      expect(localStorage.getItem('token')).toBeNull();
      expect(service.authStatus()).toBe(AuthStatus.Checking);
    });

    it('une los mensajes de validación cuando el backend devuelve una lista', () => {
      setup();
      let message = '';

      service.login('x', 'y').subscribe({ error: (m: string) => (message = m) });
      http.expectOne(`${api}/login`).flush({ message: ['email must be an email', 'password too short'] }, { status: 400, statusText: 'Bad Request' });

      expect(message).toBe('email must be an email. password too short');
    });

    it('avisa si no hay conexión con el servidor', () => {
      setup();
      let message = '';

      service.login('ada@example.com', 'secret1').subscribe({ error: (m: string) => (message = m) });
      http.expectOne(`${api}/login`).error(new ProgressEvent('error'));

      expect(message).toBe('No se pudo conectar con el servidor');
    });

    it('usa un mensaje genérico ante respuestas sin mensaje', () => {
      setup();
      let message = '';

      service.login('ada@example.com', 'secret1').subscribe({ error: (m: string) => (message = m) });
      http.expectOne(`${api}/login`).flush('boom', { status: 500, statusText: 'Server Error' });

      expect(message).toBe('Ocurrió un error inesperado');
    });

    it('mantiene la sesión en memoria si localStorage está bloqueado', () => {
      setup();
      spyOn(Storage.prototype, 'setItem').and.throwError('bloqueado');

      service.login('ada@example.com', 'secret1').subscribe();
      http.expectOne(`${api}/login`).flush(session);

      expect(service.authStatus()).toBe(AuthStatus.Authenticated);
    });
  });

  describe('register', () => {
    it('envía nombre, correo y contraseña y deja la sesión iniciada', () => {
      setup();

      service.register('Ada', 'ada@example.com', 'secret1').subscribe();
      const request = http.expectOne(`${api}/register`);
      expect(request.request.body).toEqual({ name: 'Ada', email: 'ada@example.com', password: 'secret1' });
      request.flush(session);

      expect(service.authStatus()).toBe(AuthStatus.Authenticated);
      expect(localStorage.getItem('token')).toBe('jwt-1');
    });

    it('propaga el error del backend (correo duplicado)', () => {
      setup();
      let message = '';

      service.register('Ada', 'ada@example.com', 'secret1').subscribe({ error: (m: string) => (message = m) });
      http.expectOne(`${api}/register`).flush({ message: 'El correo ya está registrado' }, { status: 400, statusText: 'Bad Request' });

      expect(message).toBe('El correo ya está registrado');
    });
  });

  describe('checkAuthStatus', () => {
    it('sin token queda como no autenticado y no llama al backend', () => {
      setup();
      let result: boolean | undefined;

      service.checkAuthStatus().subscribe((value) => (result = value));

      expect(result).toBeFalse();
      expect(service.authStatus()).toBe(AuthStatus.NotAuthenticated);
    });

    it('con token válido restaura el usuario y renueva el token', () => {
      setup();
      localStorage.setItem('token', 'jwt-viejo');
      let result: boolean | undefined;

      service.checkAuthStatus().subscribe((value) => (result = value));
      http.expectOne(`${api}/check-token`).flush({ ...session, token: 'jwt-nuevo' });

      expect(result).toBeTrue();
      expect(service.currentUser()).toEqual(session.user);
      expect(service.authStatus()).toBe(AuthStatus.Authenticated);
      expect(localStorage.getItem('token')).toBe('jwt-nuevo');
    });

    it('con token rechazado limpia la sesión', () => {
      setup();
      localStorage.setItem('token', 'jwt-vencido');
      let result: boolean | undefined;

      service.checkAuthStatus().subscribe((value) => (result = value));
      http.expectOne(`${api}/check-token`).flush({}, { status: 401, statusText: 'Unauthorized' });

      expect(result).toBeFalse();
      expect(localStorage.getItem('token')).toBeNull();
      expect(service.authStatus()).toBe(AuthStatus.NotAuthenticated);
    });

    it('trata como sin sesión un localStorage bloqueado', () => {
      setup();
      spyOn(Storage.prototype, 'getItem').and.throwError('bloqueado');
      let result: boolean | undefined;

      service.checkAuthStatus().subscribe((value) => (result = value));

      expect(result).toBeFalse();
      expect(service.authStatus()).toBe(AuthStatus.NotAuthenticated);
    });
  });

  describe('logout', () => {
    it('limpia la sesión y navega a login', () => {
      setup();
      service.login('ada@example.com', 'secret1').subscribe();
      http.expectOne(`${api}/login`).flush(session);

      service.logout();

      expect(localStorage.getItem('token')).toBeNull();
      expect(service.currentUser()).toBeNull();
      expect(service.authStatus()).toBe(AuthStatus.NotAuthenticated);
      expect(navigateByUrl).toHaveBeenCalledWith('/auth/login');
    });

    it('tolera un localStorage bloqueado', () => {
      setup();
      spyOn(Storage.prototype, 'removeItem').and.throwError('bloqueado');

      expect(() => service.logout()).not.toThrow();
      expect(service.authStatus()).toBe(AuthStatus.NotAuthenticated);
    });
  });

  describe('sincronización entre pestañas', () => {
    function authenticate() {
      service.login('ada@example.com', 'secret1').subscribe();
      http.expectOne(`${api}/login`).flush(session);
    }

    it('cierra la sesión cuando otra pestaña borra el token', () => {
      setup();
      authenticate();

      localStorage.removeItem('token');
      window.dispatchEvent(new StorageEvent('storage', { key: 'token', newValue: null }));

      expect(service.authStatus()).toBe(AuthStatus.NotAuthenticated);
      expect(navigateByUrl).toHaveBeenCalledWith('/auth/login');
    });

    it('ignora cambios de storage mientras el token sigue presente', () => {
      setup();
      authenticate();

      window.dispatchEvent(new StorageEvent('storage', { key: 'otra-clave', newValue: 'x' }));

      expect(service.authStatus()).toBe(AuthStatus.Authenticated);
      expect(navigateByUrl).not.toHaveBeenCalled();
    });
  });
});
