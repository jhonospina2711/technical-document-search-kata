import { InvalidDocumentTransitionError } from './errors';

export const DocumentStatus = {
  PROCESANDO: 'PROCESANDO',
  PROCESADO: 'PROCESADO',
  ERROR: 'ERROR',
} as const;
export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];

export const DocumentFormat = {
  TXT: 'TXT',
  PDF: 'PDF',
  MD: 'MD',
} as const;
export type DocumentFormat = (typeof DocumentFormat)[keyof typeof DocumentFormat];

export interface DocumentMetadata {
  title: string;
  author: string;
  category: string;
  tags: string[];
  version: string;
  fileName: string;
  fileFormat: DocumentFormat;
  ownerId: string;
}

export interface Document extends DocumentMetadata {
  id: string;
  status: DocumentStatus;
  /** Texto extraído; es `null` hasta que el Worker termina de procesar. */
  content: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Documento aún sin persistir: el id y las fechas los asigna la base de datos. */
export type NewDocument = DocumentMetadata & { status: typeof DocumentStatus.PROCESANDO; content: null };

export function createDocument(metadata: DocumentMetadata): NewDocument {
  return { ...metadata, tags: [...metadata.tags], status: DocumentStatus.PROCESANDO, content: null };
}

function assertCanTransition(doc: Document, to: DocumentStatus): void {
  if (doc.status !== DocumentStatus.PROCESANDO) {
    throw new InvalidDocumentTransitionError(doc.status, to);
  }
}

export function markProcessed(doc: Document, content: string): Document {
  assertCanTransition(doc, DocumentStatus.PROCESADO);
  return { ...doc, status: DocumentStatus.PROCESADO, content };
}

export function markFailed(doc: Document): Document {
  assertCanTransition(doc, DocumentStatus.ERROR);
  return { ...doc, status: DocumentStatus.ERROR };
}
