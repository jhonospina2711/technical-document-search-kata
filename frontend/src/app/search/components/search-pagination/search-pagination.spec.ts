import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SearchPagination, pageWindow } from './search-pagination';

describe('pageWindow', () => {
  it('muestra todas las páginas cuando son pocas', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('resume los huecos largos con elipsis', () => {
    expect(pageWindow(5, 10)).toEqual([1, 'ellipsis', 4, 5, 6, 'ellipsis', 10]);
  });

  it('rellena con el número un hueco de una sola página', () => {
    expect(pageWindow(4, 10)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 10]);
    expect(pageWindow(7, 10)).toEqual([1, 'ellipsis', 6, 7, 8, 9, 10]);
  });

  it('mantiene la elipsis solo en el lado necesario en los extremos', () => {
    expect(pageWindow(1, 10)).toEqual([1, 2, 'ellipsis', 10]);
    expect(pageWindow(10, 10)).toEqual([1, 'ellipsis', 9, 10]);
  });

  it('no duplica la primera ni la última página', () => {
    const items = pageWindow(2, 3);
    expect(new Set(items).size).toBe(items.length);
  });
});

describe('SearchPagination', () => {
  let fixture: ComponentFixture<SearchPagination>;
  let host: HTMLElement;
  let emitted: number[];

  const render = (page: number, total: number, pageSize = 10) => {
    fixture.componentRef.setInput('page', page);
    fixture.componentRef.setInput('total', total);
    fixture.componentRef.setInput('pageSize', pageSize);
    fixture.detectChanges();
  };
  const text = () => host.textContent!.replace(/\s+/g, ' ');
  const buttons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'));
  const byLabel = (label: string) => buttons().find((button) => button.textContent!.includes(label))!;

  beforeEach(() => {
    fixture = TestBed.createComponent(SearchPagination);
    host = fixture.nativeElement;
    emitted = [];
    fixture.componentInstance.pageChange.subscribe((page) => emitted.push(page));
  });

  it('muestra el rango, «Anterior» deshabilitado y la página 1 como actual', () => {
    render(1, 24);

    expect(host.querySelector('nav')!.getAttribute('aria-label')).toBe('Navegación de resultados');
    expect(text()).toContain('Mostrando 1–10 de 24');
    expect(byLabel('Anterior').disabled).toBeTrue();
    expect(byLabel('Siguiente').disabled).toBeFalse();
    const current = host.querySelectorAll('[aria-current=page]');
    expect(current.length).toBe(1);
    expect(current[0].textContent!.trim()).toBe('1');
  });

  it('emite la página siguiente al pulsar «Siguiente»', () => {
    render(1, 24);

    byLabel('Siguiente').click();

    expect(emitted).toEqual([2]);
  });

  it('emite la página anterior y la elegida', () => {
    render(2, 24);

    byLabel('Anterior').click();
    host.querySelector<HTMLButtonElement>('[aria-label="Página 3"]')!.click();

    expect(emitted).toEqual([1, 3]);
  });

  it('en la última página ajusta el rango y deshabilita «Siguiente»', () => {
    render(3, 24);

    expect(text()).toContain('Mostrando 21–24 de 24');
    expect(byLabel('Siguiente').disabled).toBeTrue();
  });

  it('no emite al pulsar la página actual ni un botón deshabilitado', () => {
    render(1, 24);

    host.querySelector<HTMLButtonElement>('[aria-current=page]')!.click();
    byLabel('Anterior').click();

    expect(emitted).toEqual([]);
  });

  it('muestra la elipsis entre bloques y la oculta a los lectores de pantalla', () => {
    render(5, 100);

    const ellipses = host.querySelectorAll('.pagination__ellipsis');
    expect(ellipses.length).toBe(2);
    ellipses.forEach((ellipsis) => expect(ellipsis.getAttribute('aria-hidden')).toBe('true'));
    const numbers = buttons()
      .filter((button) => button.hasAttribute('aria-label'))
      .map((button) => button.textContent!.trim());
    expect(numbers).toEqual(['1', '4', '5', '6', '10']);
  });

  it('acota una página fuera de rango a la última', () => {
    render(99, 24);

    expect(text()).toContain('Mostrando 21–24 de 24');
    expect(host.querySelector('[aria-current=page]')!.textContent!.trim()).toBe('3');
  });

  it('no se muestra con 10 resultados o menos ni sin resultados', () => {
    render(1, 10);
    expect(host.querySelector('nav')).toBeNull();

    render(1, 0);
    expect(host.querySelector('nav')).toBeNull();
  });
});
