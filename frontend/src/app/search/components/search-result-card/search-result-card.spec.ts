import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SearchResultItem } from '../../interfaces/search.interfaces';
import { SearchResultCard } from './search-result-card';

const ITEM: SearchResultItem = {
  id: '3f1b7a10-0001-4c1e-9a10-000000000001',
  title: 'Manual de Despliegue de Kubernetes',
  author: 'Ing. Marcos Silva',
  format: 'PDF',
  version: '1.4.0',
  tags: ['k8s', 'helm'],
  createdAt: '2024-10-18T12:00:00.000Z',
  score: 0.94,
  snippet: {
    segments: [
      { text: 'Para la ', highlight: false },
      { text: 'configuración de kubernetes', highlight: true },
      { text: ' en topología multi-master', highlight: false },
    ],
    truncatedStart: true,
    truncatedEnd: true,
  },
};

describe('SearchResultCard', () => {
  let fixture: ComponentFixture<SearchResultCard>;
  let host: HTMLElement;

  const render = (overrides: Partial<SearchResultItem> = {}) => {
    fixture.componentRef.setInput('item', { ...ITEM, ...overrides });
    fixture.detectChanges();
  };
  const text = () => host.textContent!.replace(/\s+/g, ' ');
  const snippet = () => host.querySelector<HTMLElement>('.snippet');

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    fixture = TestBed.createComponent(SearchResultCard);
    host = fixture.nativeElement;
  });

  it('muestra formato, título, autor, fecha, versión y tags', () => {
    render();

    expect(host.querySelector('.badge')!.textContent).toBe('PDF');
    expect(host.querySelector('.card__title')!.textContent).toBe(ITEM.title);
    expect(host.querySelector('.card__title')!.getAttribute('title')).toBe(ITEM.title);
    expect(text()).toContain('Ing. Marcos Silva');
    expect(text()).toContain('v1.4.0');
    expect(text()).toContain('#k8s');
    expect(text()).toContain('#helm');
    const time = host.querySelector('time')!;
    expect(time.getAttribute('datetime')).toBe('2024-10-18T12:00:00.000Z');
    expect(time.textContent).toMatch(/^18 oct\.? 2024$/i);
  });

  it('enlaza el título y «Ver documento» a /documents/:id', () => {
    render();

    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('a'));
    expect(links.length).toBe(2);
    for (const link of links) {
      expect(link.getAttribute('href')).toBe(`/documents/${ITEM.id}`);
    }
    expect(links[1].getAttribute('aria-label')).toBe(`Ver documento: ${ITEM.title}`);
  });

  it('SPEC-11 AC-17: con término, los enlaces llevan ?q= y sin término no', () => {
    fixture.componentRef.setInput('term', 'kubernetes & helm');
    render();

    const hrefs = Array.from(host.querySelectorAll<HTMLAnchorElement>('a')).map((link) => link.getAttribute('href')!);
    expect(hrefs.length).toBe(2);
    for (const href of hrefs) {
      const url = new URL(href, 'http://localhost');
      expect(url.pathname).toBe(`/documents/${ITEM.id}`);
      expect(url.searchParams.get('q')).toBe('kubernetes & helm');
    }

    fixture.componentRef.setInput('term', '');
    fixture.detectChanges();
    for (const link of Array.from(host.querySelectorAll<HTMLAnchorElement>('a'))) {
      expect(link.getAttribute('href')).toBe(`/documents/${ITEM.id}`);
    }
  });

  it('resalta solo los segmentos marcados y añade puntos suspensivos al truncar', () => {
    render();

    const marks = Array.from(snippet()!.querySelectorAll('mark'));
    expect(marks.map((mark) => mark.textContent)).toEqual(['configuración de kubernetes']);
    expect(snippet()!.textContent!.trim()).toBe('…Para la configuración de kubernetes en topología multi-master…');
  });

  it('omite los puntos suspensivos si el fragmento no está truncado', () => {
    render({ snippet: { ...ITEM.snippet, truncatedStart: false, truncatedEnd: false } });

    expect(snippet()!.textContent!.trim()).toBe('Para la configuración de kubernetes en topología multi-master');
  });

  it('muestra como texto literal el HTML que venga en el contenido', () => {
    render({
      title: '<img src=x onerror=alert(1)>',
      tags: ['<b>tag</b>'],
      snippet: {
        segments: [
          { text: '<script>alert(1)</script>', highlight: false },
          { text: '<b>negrita</b>', highlight: true },
        ],
        truncatedStart: false,
        truncatedEnd: false,
      },
    });

    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('b')).toBeNull();
    expect(snippet()!.textContent).toContain('<script>alert(1)</script>');
    expect(snippet()!.querySelector('mark')!.textContent).toBe('<b>negrita</b>');
    expect(host.querySelector('.card__title')!.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(text()).toContain('#<b>tag</b>');
  });

  it('muestra la relevancia como porcentaje con un medidor accesible', () => {
    render();

    expect(text()).toContain('Relevancia 94 %');
    const meter = host.querySelector('[role=meter]')!;
    expect(meter.getAttribute('aria-valuenow')).toBe('94');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('100');
    expect(host.querySelector<HTMLElement>('.meter__fill')!.style.width).toBe('94%');
  });

  it('acota puntuaciones fuera de rango y no numéricas', () => {
    for (const [score, expected] of [
      [1.7, '100'],
      [-0.2, '0'],
      [Number.NaN, '0'],
    ] as const) {
      render({ score });
      expect(host.querySelector('[role=meter]')!.getAttribute('aria-valuenow')).withContext(`${score}`).toBe(expected);
    }
  });

  it('muestra «—» si la fecha no es válida', () => {
    render({ createdAt: 'no-es-fecha' });

    expect(host.querySelector('time')).toBeNull();
    expect(host.querySelector('.card__meta')!.textContent).toContain('—');
  });

  it('omite el fragmento si no hay segmentos y los tags si no hay ninguno', () => {
    render({ tags: [], snippet: { segments: [], truncatedStart: false, truncatedEnd: false } });

    expect(snippet()).toBeNull();
    expect(host.querySelector('.tags')).toBeNull();
  });

  it('actualiza el formato como atributo para el estilo de la insignia', () => {
    render({ format: 'MD' });

    expect(host.querySelector('.badge')!.getAttribute('data-format')).toBe('MD');
  });
});
