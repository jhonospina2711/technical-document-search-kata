import { Component, WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { User } from '../auth/interfaces/user.interface';
import { AuthService } from '../auth/services/auth.service';
import { AppShell } from './app-shell';

@Component({ template: '<main>página</main>' })
class PageStub {}

describe('AppShell', () => {
  let harness: RouterTestingHarness;
  let logout: jasmine.Spy;
  let currentUser: WritableSignal<User | null>;

  const host = () => harness.fixture.nativeElement as HTMLElement;
  const uploadLink = () =>
    [...host().querySelectorAll<HTMLAnchorElement>('a')].find((link) => link.textContent!.includes('+ Cargar'));

  beforeEach(async () => {
    logout = jasmine.createSpy('logout');
    currentUser = signal<User | null>({
      id: 'u1',
      email: 'ada@example.com',
      name: 'Ada <b>Lovelace</b>',
      isActive: true,
      roles: ['user'],
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: '',
            component: AppShell,
            children: [
              { path: '', pathMatch: 'full', component: PageStub },
              { path: 'documents/upload', component: PageStub },
              { path: 'documents/:id', component: PageStub },
            ],
          },
        ]),
        { provide: AuthService, useValue: { currentUser, logout } },
      ],
    });
    harness = await RouterTestingHarness.create();
  });

  it('AC-01: muestra la marca enlazada a /, "+ Cargar", el usuario como texto y "Cerrar sesión"', async () => {
    await harness.navigateByUrl('/');

    const brand = host().querySelector<HTMLAnchorElement>('.brand')!;
    expect(brand.textContent).toContain('Documentos técnicos');
    expect(brand.getAttribute('href')).toBe('/');
    expect(uploadLink()?.getAttribute('href')).toBe('/documents/upload');
    expect(host().querySelector('.shell-user')!.textContent).toBe('Ada <b>Lovelace</b>');
    expect(host().querySelector('.shell-user b')).toBeNull();
    expect(host().querySelector('nav')!.getAttribute('aria-label')).toBe('Principal');
    expect(host().textContent).toContain('página');
  });

  it('AC-03: oculta "+ Cargar" en /documents/upload y lo vuelve a mostrar al salir', async () => {
    await harness.navigateByUrl('/documents/upload');
    expect(uploadLink()).toBeUndefined();

    await harness.navigateByUrl('/documents/abc?q=x');
    expect(uploadLink()).toBeDefined();

    await harness.navigateByUrl('/documents/upload?from=x');
    expect(uploadLink()).toBeUndefined();
  });

  it('AC-06: "Cerrar sesión" llama a logout()', async () => {
    await harness.navigateByUrl('/');

    const button = [...host().querySelectorAll('button')].find((b) => b.textContent!.includes('Cerrar sesión'))!;
    button.click();

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('sin usuario cargado no falla', async () => {
    currentUser.set(null);
    await harness.navigateByUrl('/');

    expect(host().querySelector('.shell-user')!.textContent).toBe('');
  });
});
