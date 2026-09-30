import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DocumentDetail, DocumentFormat } from '../../interfaces/document.interfaces';
import { formatUtc } from '../../utils/format-utc';

const FORMAT_LABELS: Record<DocumentFormat, string> = {
  PDF: 'PDF (Documento portable)',
  MD: 'Markdown',
  TXT: 'Texto plano',
};

/** Ficha de metadatos del documento. Presentacional: el portapapeles lo gestiona el padre vía `copyId`. */
@Component({
  selector: 'app-document-metadata-panel',
  templateUrl: './document-metadata-panel.html',
  styleUrl: './document-metadata-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentMetadataPanel {
  readonly document = input.required<DocumentDetail>();
  /** Resultado de la última copia del ID ("Copiado" / "No se pudo copiar"), anunciado en una región `aria-live`. */
  readonly idCopyFeedback = input<string | null>(null);

  readonly copyId = output<void>();

  protected readonly formatLabel = computed(() => FORMAT_LABELS[this.document().fileFormat]);
  protected readonly createdAt = computed(() => formatUtc(this.document().createdAt));
  protected readonly updatedAt = computed(() => formatUtc(this.document().updatedAt));
}
