import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FileDropzone } from './file-dropzone';

function fileList(...files: File[]): DataTransfer {
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  return transfer;
}

function dragEvent(type: string, transfer: DataTransfer): DragEvent {
  return new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true });
}

describe('FileDropzone', () => {
  let fixture: ComponentFixture<FileDropzone>;
  let host: HTMLElement;
  let selected: File[][];
  let removed: number;

  const dropzone = () => host.querySelector<HTMLElement>('.dropzone')!;
  const picker = () => host.querySelector<HTMLInputElement>('input[type=file]')!;
  const text = () => host.textContent!.replace(/\s+/g, ' ');

  beforeEach(() => {
    fixture = TestBed.createComponent(FileDropzone);
    host = fixture.nativeElement;
    selected = [];
    removed = 0;
    fixture.componentInstance.filesSelected.subscribe((files) => selected.push(files));
    fixture.componentInstance.removed.subscribe(() => removed++);
    fixture.detectChanges();
  });

  it('muestra el estado vacío con las instrucciones y restringe el selector a .txt, .pdf y .md', () => {
    expect(text()).toContain('Arrastra tu archivo aquí o selecciona');
    expect(picker().accept).toBe('.txt,.pdf,.md');
  });

  it('enlaza la ayuda con aria-describedby', () => {
    fixture.componentRef.setInput('describedBy', 'ayuda');
    fixture.detectChanges();

    expect(host.querySelector('.dropzone__pick')!.getAttribute('aria-describedby')).toBe('ayuda');
  });

  it('el botón abre el selector de archivos', () => {
    const click = spyOn(picker(), 'click');

    host.querySelector<HTMLButtonElement>('.dropzone__pick')!.click();

    expect(click).toHaveBeenCalled();
  });

  it('emite los archivos elegidos en el selector y limpia el input para poder repetir la elección', () => {
    const file = new File(['x'], 'a.txt');
    picker().files = fileList(file).files;

    picker().dispatchEvent(new Event('change'));

    expect(selected).toEqual([[file]]);
    expect(picker().value).toBe('');
  });

  it('no emite nada si el selector se cierra sin archivos', () => {
    picker().dispatchEvent(new Event('change'));

    expect(selected).toEqual([]);
  });

  it('muestra el estado drag-over al arrastrar archivos y vuelve al salir', () => {
    const transfer = fileList(new File(['x'], 'a.txt'));

    dropzone().dispatchEvent(dragEvent('dragenter', transfer));
    fixture.detectChanges();
    expect(text()).toContain('Suelta el archivo para cargarlo');

    dropzone().dispatchEvent(dragEvent('dragleave', transfer));
    fixture.detectChanges();
    expect(text()).toContain('Arrastra tu archivo aquí');
  });

  it('no parpadea al cruzar elementos hijos (dragenter doble, dragleave simple)', () => {
    const transfer = fileList(new File(['x'], 'a.txt'));

    dropzone().dispatchEvent(dragEvent('dragenter', transfer));
    dropzone().dispatchEvent(dragEvent('dragenter', transfer));
    dropzone().dispatchEvent(dragEvent('dragleave', transfer));
    fixture.detectChanges();
    expect(text()).toContain('Suelta el archivo para cargarlo');

    dropzone().dispatchEvent(dragEvent('dragleave', transfer));
    fixture.detectChanges();
    expect(text()).not.toContain('Suelta el archivo para cargarlo');
  });

  it('permite soltar (cancela dragover) cuando se arrastran archivos', () => {
    const event = dragEvent('dragover', fileList(new File(['x'], 'a.txt')));

    dropzone().dispatchEvent(event);

    expect(event.defaultPrevented).toBeTrue();
  });

  it('ignora arrastres que no son archivos', () => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'hola');
    const over = dragEvent('dragover', transfer);

    dropzone().dispatchEvent(dragEvent('dragenter', transfer));
    dropzone().dispatchEvent(over);
    fixture.detectChanges();

    expect(text()).not.toContain('Suelta el archivo');
    expect(over.defaultPrevented).toBeFalse();
  });

  it('emite todos los archivos soltados y sale del estado drag-over', () => {
    const files = [new File(['x'], 'a.txt'), new File(['y'], 'b.md')];
    const transfer = fileList(...files);

    dropzone().dispatchEvent(dragEvent('dragenter', transfer));
    dropzone().dispatchEvent(dragEvent('drop', transfer));
    fixture.detectChanges();

    expect(selected).toEqual([files]);
    expect(text()).not.toContain('Suelta el archivo');
  });

  it('no emite si se suelta sin archivos', () => {
    const transfer = fileList(new File(['x'], 'a.txt'));
    transfer.items.clear();

    dropzone().dispatchEvent(dragEvent('drop', transfer));

    expect(selected).toEqual([]);
  });

  it('muestra el archivo adjunto con formato, tamaño y "Validado"', () => {
    fixture.componentRef.setInput('file', new File([new Uint8Array(2048)], 'especificacion.pdf'));
    fixture.detectChanges();

    expect(text()).toContain('especificacion.pdf');
    expect(text()).toContain('2 KB');
    expect(text()).toContain('Validado');
    expect(host.querySelector('.dropzone__format')!.textContent).toContain('PDF');
  });

  it('"Cambiar archivo" abre el selector y "Quitar archivo" emite removed', () => {
    fixture.componentRef.setInput('file', new File(['x'], 'a.md'));
    fixture.detectChanges();
    const click = spyOn(picker(), 'click');
    const [change, remove] = Array.from(host.querySelectorAll<HTMLButtonElement>('.link-button'));

    change.click();
    remove.click();

    expect(click).toHaveBeenCalled();
    expect(removed).toBe(1);
  });

  it('muestra el progreso de subida accesible y el texto del servidor al llegar a 100 %', () => {
    fixture.componentRef.setInput('file', new File(['x'], 'a.txt'));
    fixture.componentRef.setInput('uploading', true);
    fixture.componentRef.setInput('progress', { percent: 68, loaded: 2 * 1024 * 1024, total: 3 * 1024 * 1024 });
    fixture.detectChanges();

    const bar = host.querySelector('[role=progressbar]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('68');
    expect(text()).toContain('Subiendo archivo…');
    expect(text()).toContain('68%');
    expect(text()).toContain('2 MB de 3 MB');

    fixture.componentRef.setInput('progress', { percent: 100, loaded: 3 * 1024 * 1024, total: 3 * 1024 * 1024 });
    fixture.detectChanges();
    expect(text()).toContain('Procesando en el servidor…');
  });

  it('muestra 0 % y sin bytes si aún no hay progreso', () => {
    fixture.componentRef.setInput('file', new File(['x'], 'a.txt'));
    fixture.componentRef.setInput('uploading', true);
    fixture.detectChanges();

    expect(host.querySelector('[role=progressbar]')!.getAttribute('aria-valuenow')).toBe('0');
    expect(host.querySelector('.dropzone__uploading-foot span:last-child')!.textContent!.trim()).toBe('');
  });

  it('ignora arrastres y no muestra el estado drag-over mientras sube', () => {
    fixture.componentRef.setInput('file', new File(['x'], 'a.txt'));
    fixture.componentRef.setInput('uploading', true);
    fixture.detectChanges();
    const transfer = fileList(new File(['y'], 'b.txt'));

    dropzone().dispatchEvent(dragEvent('dragenter', transfer));
    dropzone().dispatchEvent(dragEvent('drop', transfer));
    fixture.detectChanges();

    expect(selected).toEqual([]);
    expect(text()).not.toContain('Suelta el archivo');
  });
});
