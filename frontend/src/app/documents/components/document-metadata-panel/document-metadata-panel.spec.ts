import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DocumentDetail } from '../../interfaces/document.interfaces';
import { DocumentMetadataPanel } from './document-metadata-panel';

const doc: DocumentDetail = {
  id: 'e4b291a0-7f28-4c89-9a2d-b31057e93f61',
  title: 'Manual de Configuración y Despliegue',
  author: 'Ing. Carlos Mendoza',
  category: 'Infraestructura y Redes',
  tags: ['redes', 'bgp'],
  version: '2.4.1',
  fileName: 'manual_redes_ha_v2.4.1_prod.pdf',
  fileFormat: 'PDF',
  status: 'PROCESADO',
  content: 'texto',
  createdAt: '2024-10-14T09:30:00.000Z',
  updatedAt: '2024-10-22T16:45:00.000Z',
};

describe('DocumentMetadataPanel', () => {
  let fixture: ComponentFixture<DocumentMetadataPanel>;

  beforeAll(() => registerLocaleData(localeEs));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [DocumentMetadataPanel] });
    fixture = TestBed.createComponent(DocumentMetadataPanel);
  });

  function render(document: Partial<DocumentDetail> = {}, feedback: string | null = null): HTMLElement {
    fixture.componentRef.setInput('document', { ...doc, ...document });
    fixture.componentRef.setInput('idCopyFeedback', feedback);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /** Pares etiqueta → texto de la lista de definición. */
  function fields(root: HTMLElement): Record<string, string> {
    const result: Record<string, string> = {};
    root.querySelectorAll('dt').forEach((dt) => {
      result[dt.textContent!.trim()] = dt.nextElementSibling!.textContent!.replace(/\s+/g, ' ').trim();
    });
    return result;
  }

  it('AC-01: muestra todos los campos del documento', () => {
    const root = render();

    expect(root.querySelector('aside')?.getAttribute('aria-label')).toBe('Metadatos del documento');
    expect(root.querySelector('h2')?.textContent).toContain('Metadatos del documento');
    const values = fields(root);
    expect(values['ID']).toContain(doc.id);
    expect(values['Título']).toBe(doc.title);
    expect(values['Autor']).toBe(doc.author);
    expect(values['Categoría']).toBe(doc.category);
    expect([...root.querySelectorAll('.tag')].map((tag) => tag.textContent)).toEqual(['#redes', '#bgp']);
    expect(values['Versión']).toBe('2.4.1');
    expect(values['Nombre de archivo']).toBe(doc.fileName);
    expect(values['Formato']).toBe('PDF (Documento portable)');
    expect(values['Creado el']).toBe('14 oct 2024, 09:30 UTC');
    expect(values['Actualizado el']).toBe('22 oct 2024, 16:45 UTC');
  });

  it('usa una etiqueta fija por formato', () => {
    expect(fields(render({ fileFormat: 'MD' }))['Formato']).toBe('Markdown');
    expect(fields(render({ fileFormat: 'TXT' }))['Formato']).toBe('Texto plano');
  });

  it('AC-14: sin etiquetas muestra "Sin etiquetas"', () => {
    const root = render({ tags: [] });

    expect(fields(root)['Etiquetas']).toBe('Sin etiquetas');
    expect(root.querySelector('.tags')).toBeNull();
  });

  it('AC-14: una fecha inválida se muestra como "—"', () => {
    const values = fields(render({ createdAt: 'no-es-fecha', updatedAt: '' }));

    expect(values['Creado el']).toBe('—');
    expect(values['Actualizado el']).toBe('—');
  });

  it('muestra el nombre de archivo completo en el atributo title', () => {
    const root = render();

    const fileName = root.querySelector('dd[title]');
    expect(fileName?.getAttribute('title')).toBe(doc.fileName);
  });

  it('el botón Copiar del ID emite copyId', () => {
    const root = render();
    let emitted = 0;
    fixture.componentInstance.copyId.subscribe(() => emitted++);

    const button = root.querySelector<HTMLButtonElement>('button[aria-label="Copiar ID del documento"]')!;
    button.click();

    expect(button.textContent).toContain('Copiar');
    expect(emitted).toBe(1);
  });

  it('anuncia el resultado de la copia del ID en una región aria-live', () => {
    const root = render({}, 'Copiado');

    const live = root.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe('Copiado');
  });

  it('sin feedback la región aria-live existe y está vacía', () => {
    const live = render().querySelector('[aria-live="polite"]');

    expect(live).not.toBeNull();
    expect(live?.textContent?.trim()).toBe('');
  });

  it('los textos de usuario se muestran como texto, no como HTML', () => {
    const root = render({ title: '<b>negrita</b>', tags: ['<script>x</script>'] });

    expect(root.querySelector('dd b')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
    expect(fields(root)['Título']).toBe('<b>negrita</b>');
  });
});
