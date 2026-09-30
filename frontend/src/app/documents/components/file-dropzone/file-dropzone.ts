import { ChangeDetectionStrategy, Component, ElementRef, computed, input, model, output, viewChild } from '@angular/core';
import { UploadProgress } from '../../interfaces/document.interfaces';
import { fileFormatOf, formatBytes } from '../../validators/file-validation';

/** Zona de selección de archivo: clic/teclado y arrastrar y soltar. No valida; emite lo que recibe. */
@Component({
  selector: 'app-file-dropzone',
  templateUrl: './file-dropzone.html',
  styleUrl: './file-dropzone.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileDropzone {
  readonly file = input<File | null>(null);
  readonly uploading = input(false);
  readonly progress = input<UploadProgress | null>(null);
  readonly describedBy = input<string | null>(null);

  readonly filesSelected = output<File[]>();
  readonly removed = output<void>();

  /** `true` mientras se arrastra un archivo encima; el padre lo enlaza con `[(dragging)]` para su indicador. */
  readonly dragging = model(false);
  protected readonly format = computed(() => {
    const file = this.file();
    return file ? fileFormatOf(file.name) : null;
  });
  protected readonly sizeLabel = computed(() => formatBytes(this.file()?.size ?? 0));
  protected readonly percent = computed(() => this.progress()?.percent ?? 0);
  protected readonly bytesLabel = computed(() => {
    const progress = this.progress();
    return progress && progress.total > 0
      ? `${formatBytes(progress.loaded)} de ${formatBytes(progress.total)}`
      : '';
  });

  private readonly picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');
  // dragenter/dragleave se disparan también al cruzar hijos; el contador evita el parpadeo.
  private dragDepth = 0;

  protected openPicker(): void {
    this.picker().nativeElement.click();
  }

  protected onPicked(): void {
    const input = this.picker().nativeElement;
    const files = Array.from(input.files ?? []);
    // Permite volver a elegir el mismo archivo después de quitarlo o de un rechazo.
    input.value = '';
    if (files.length > 0) {
      this.filesSelected.emit(files);
    }
  }

  protected onDragEnter(event: DragEvent): void {
    if (!this.acceptsDrag(event)) return;
    event.preventDefault();
    this.dragDepth++;
    this.dragging.set(true);
  }

  protected onDragOver(event: DragEvent): void {
    if (!this.acceptsDrag(event)) return;
    event.preventDefault();
  }

  protected onDragLeave(event: DragEvent): void {
    if (!this.acceptsDrag(event)) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) {
      this.dragging.set(false);
    }
  }

  protected onDrop(event: DragEvent): void {
    if (!this.acceptsDrag(event)) return;
    event.preventDefault();
    this.dragDepth = 0;
    this.dragging.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) {
      this.filesSelected.emit(files);
    }
  }

  /** Solo se reacciona a arrastres de archivos y nunca mientras se sube. */
  private acceptsDrag(event: DragEvent): boolean {
    return !this.uploading() && (event.dataTransfer?.types ?? []).includes('Files');
  }
}
