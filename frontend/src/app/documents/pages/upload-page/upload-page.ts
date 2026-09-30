import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { FileDropzone } from '../../components/file-dropzone/file-dropzone';
import { DOCUMENT_CATEGORIES } from '../../constants/document-categories';
import { DocumentMetadata, UploadedDocument, UploadProgress } from '../../interfaces/document.interfaces';
import { DocumentsService, UploadFailure } from '../../services/documents.service';
import { fileFormatOf, formatBytes, validateFile } from '../../validators/file-validation';
import { notBlank } from '../../validators/text.validators';
import { semverValidator } from '../../validators/version.validator';

const MAX_TEXT_LENGTH = 120;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;

type TextField = 'title' | 'author' | 'category' | 'version';

@Component({
  selector: 'app-upload-page',
  imports: [ReactiveFormsModule, RouterLink, FileDropzone],
  templateUrl: './upload-page.html',
  styleUrl: './upload-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadPage {
  private readonly documents = inject(DocumentsService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly categories = DOCUMENT_CATEGORIES;
  protected readonly maxLabel = formatBytes(environment.maxFileSizeBytes);
  protected readonly maxTextLength = MAX_TEXT_LENGTH;

  protected readonly form = inject(NonNullableFormBuilder).group({
    title: ['', [notBlank, Validators.maxLength(MAX_TEXT_LENGTH)]],
    author: ['', [notBlank, Validators.maxLength(MAX_TEXT_LENGTH)]],
    category: ['', [Validators.required]],
    version: ['', [notBlank, semverValidator]],
  });

  protected readonly tags = signal<string[]>([]);
  protected readonly tagDraft = new FormControl('', { nonNullable: true });
  protected readonly tagError = signal<string | null>(null);

  protected readonly file = signal<File | null>(null);
  protected readonly dragging = signal(false);
  protected readonly uploading = signal(false);
  protected readonly progress = signal<UploadProgress | null>(null);

  protected readonly fileError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly serverError = signal<UploadFailure | null>(null);
  protected readonly created = signal<UploadedDocument | null>(null);

  private readonly formStatus = toSignal(this.form.statusChanges, { initialValue: this.form.status });
  protected readonly canSubmit = computed(
    () => this.formStatus() === 'VALID' && this.file() !== null && !this.uploading(),
  );

  protected readonly fileIndicator = computed(() => {
    if (this.uploading()) return `Cargando (${this.progress()?.percent ?? 0}%)`;
    if (this.fileError()) return 'Error de archivo';
    if (this.dragging()) return 'Arrastrando…';
    const file = this.file();
    if (file) return `${fileFormatOf(file.name)} · ${formatBytes(file.size)}`;
    return this.created() ? 'Carga completada' : 'Sin adjuntar';
  });

  protected errorOf(name: TextField): string | null {
    const control = this.form.controls[name];
    if (!control.touched || !control.errors) return null;
    if (control.errors['maxlength']) return `Máximo ${MAX_TEXT_LENGTH} caracteres`;
    if (control.errors['semver']) return 'Usa el formato MAJOR.MINOR.PATCH (ej. 1.0.0)';
    return name === 'category' ? 'Selecciona una categoría válida' : 'Este campo es obligatorio';
  }

  protected onFilesSelected(files: File[]): void {
    const error = files.length > 1 ? 'Solo se admite un archivo' : validateFile(files[0], environment.maxFileSizeBytes);
    this.serverError.set(null);
    this.formError.set(null);
    this.fileError.set(error);
    if (!error) {
      this.file.set(files[0]);
    }
  }

  protected removeFile(): void {
    this.file.set(null);
    this.fileError.set(null);
  }

  protected onTagKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.commitDraft();
    } else if (event.key === 'Backspace' && this.tagDraft.value === '' && this.tags().length > 0) {
      this.tags.update((tags) => tags.slice(0, -1));
    }
  }

  /** Al pegar o autocompletar texto con comas se parte en varios tags; lo que sigue a la última coma queda como borrador. */
  protected onTagInput(): void {
    const value = this.tagDraft.value;
    if (!value.includes(',')) return;
    const parts = value.split(',');
    const rest = parts.pop() ?? '';
    parts.forEach((part) => this.addTag(part));
    this.tagDraft.setValue(rest);
  }

  protected commitDraft(): void {
    if (this.addTag(this.tagDraft.value)) {
      this.tagDraft.setValue('');
    }
  }

  protected removeTag(index: number): void {
    this.tags.update((tags) => tags.filter((_, position) => position !== index));
    this.tagError.set(null);
  }

  protected submit(): void {
    if (!this.canSubmit()) return;
    this.commitDraft();
    const file = this.file();
    if (!file) return;
    const metadata: DocumentMetadata = { ...this.form.getRawValue(), tags: this.tags() };

    this.serverError.set(null);
    this.formError.set(null);
    this.created.set(null);
    this.progress.set({ percent: 0, loaded: 0, total: 0 });
    this.uploading.set(true);
    this.form.disable({ emitEvent: false });
    this.tagDraft.disable({ emitEvent: false });

    this.documents
      .upload(file, metadata)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => {
          if (event.type === 'progress') {
            this.progress.set({ percent: event.percent, loaded: event.loaded, total: event.total });
          } else {
            this.onUploaded(event.document);
          }
        },
        error: (failure: UploadFailure) => this.onFailed(failure),
      });
  }

  protected cancel(): void {
    this.resetForm();
    this.fileError.set(null);
    this.formError.set(null);
    this.serverError.set(null);
    this.created.set(null);
    void this.router.navigateByUrl('/');
  }

  /** Devuelve `true` si el texto quedó resuelto (añadido, repetido o vacío) y `false` si se rechazó. */
  private addTag(raw: string): boolean {
    const tag = raw.trim();
    if (!tag || this.tags().includes(tag)) {
      this.tagError.set(null);
      return true;
    }
    if (tag.length > MAX_TAG_LENGTH) {
      this.tagError.set(`Cada tag admite hasta ${MAX_TAG_LENGTH} caracteres`);
      return false;
    }
    if (this.tags().length >= MAX_TAGS) {
      this.tagError.set(`Máximo ${MAX_TAGS} tags`);
      return false;
    }
    this.tags.update((tags) => [...tags, tag]);
    this.tagError.set(null);
    return true;
  }

  private onUploaded(document: UploadedDocument): void {
    this.unlock();
    this.resetForm();
    this.created.set(document);
  }

  private onFailed(failure: UploadFailure): void {
    this.unlock();
    if (failure.kind === 'file') {
      this.fileError.set(failure.message);
    } else if (failure.kind === 'fields') {
      this.formError.set(failure.message);
    } else if (failure.kind === 'server') {
      this.serverError.set(failure);
    }
    // `unauthorized`: authInterceptor ya cerró la sesión y redirige a login.
  }

  private unlock(): void {
    this.uploading.set(false);
    this.progress.set(null);
    this.form.enable({ emitEvent: true });
    this.tagDraft.enable({ emitEvent: false });
  }

  private resetForm(): void {
    this.form.reset();
    this.tags.set([]);
    this.tagDraft.reset();
    this.tagError.set(null);
    this.file.set(null);
  }
}
