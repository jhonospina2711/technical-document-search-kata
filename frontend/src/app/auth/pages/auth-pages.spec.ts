import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { LoginPage } from './login-page/login-page';
import { RegisterPage } from './register-page/register-page';

function setup<T>(component: new () => T, auth: Partial<Record<'login' | 'register', jasmine.Spy>>) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
  });
  const navigateByUrl = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
  const fixture: ComponentFixture<T> = TestBed.createComponent(component);
  fixture.detectChanges();
  const root: HTMLElement = fixture.nativeElement;
  const type = (selector: string, value: string) => {
    const input = root.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const submit = () => {
    root.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  };
  return { fixture, root, type, submit, navigateByUrl };
}

describe('LoginPage', () => {
  it('con el formulario vacío muestra errores y no llama al backend', () => {
    const login = jasmine.createSpy('login');
    const { root, submit } = setup(LoginPage, { login });

    submit();

    expect(login).not.toHaveBeenCalled();
    expect(root.querySelectorAll('.field-error').length).toBe(2);
    expect(root.querySelector('#email')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('rechaza correo inválido y contraseña corta', () => {
    const login = jasmine.createSpy('login');
    const { root, type, submit } = setup(LoginPage, { login });

    type('#email', 'no-es-correo');
    type('#password', '123');
    submit();

    expect(login).not.toHaveBeenCalled();
    expect(root.querySelectorAll('.field-error').length).toBe(2);
  });

  it('inicia sesión con los datos (correo sin espacios) y navega a la ruta privada', () => {
    const login = jasmine.createSpy('login').and.returnValue(of(undefined));
    const { type, submit, navigateByUrl } = setup(LoginPage, { login });

    type('#email', ' ada@example.com ');
    type('#password', 'secret1');
    submit();

    expect(login).toHaveBeenCalledWith('ada@example.com', 'secret1');
    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('muestra el error del backend y vuelve a habilitar el envío', () => {
    const login = jasmine.createSpy('login').and.returnValue(throwError(() => 'Credenciales inválidas'));
    const { root, type, submit, navigateByUrl } = setup(LoginPage, { login });

    type('#email', 'ada@example.com');
    type('#password', 'secret1');
    submit();

    expect(root.querySelector('.form-error')!.textContent).toContain('Credenciales inválidas');
    expect(root.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBeFalse();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });
});

describe('RegisterPage', () => {
  it('con el formulario vacío muestra errores y no llama al backend', () => {
    const register = jasmine.createSpy('register');
    const { root, submit } = setup(RegisterPage, { register });

    submit();

    expect(register).not.toHaveBeenCalled();
    expect(root.querySelectorAll('.field-error').length).toBe(3);
  });

  it('rechaza una contraseña de más de 72 caracteres', () => {
    const register = jasmine.createSpy('register');
    const { type, submit } = setup(RegisterPage, { register });

    type('#name', 'Ada');
    type('#email', 'ada@example.com');
    type('#password', 'x'.repeat(73));
    submit();

    expect(register).not.toHaveBeenCalled();
  });

  it('registra al usuario y navega a la ruta privada', () => {
    const register = jasmine.createSpy('register').and.returnValue(of(undefined));
    const { type, submit, navigateByUrl } = setup(RegisterPage, { register });

    type('#name', ' Ada ');
    type('#email', 'ada@example.com');
    type('#password', 'secret1');
    submit();

    expect(register).toHaveBeenCalledWith('Ada', 'ada@example.com', 'secret1');
    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('muestra el error del backend (correo duplicado)', () => {
    const register = jasmine.createSpy('register').and.returnValue(throwError(() => 'El correo ya está registrado'));
    const { root, type, submit } = setup(RegisterPage, { register });

    type('#name', 'Ada');
    type('#email', 'ada@example.com');
    type('#password', 'secret1');
    submit();

    expect(root.querySelector('.form-error')!.textContent).toContain('El correo ya está registrado');
  });
});
