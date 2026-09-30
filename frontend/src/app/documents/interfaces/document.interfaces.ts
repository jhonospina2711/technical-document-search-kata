export type DocumentFormat = 'TXT' | 'PDF' | 'MD';

export type DocumentStatus = 'PROCESANDO' | 'PROCESADO' | 'ERROR';

/** Metadata que el usuario completa; se envía como campos multipart junto con el archivo. */
export interface DocumentMetadata {
  title: string;
  author: string;
  category: string;
  version: string;
  tags: string[];
}

/** Avance de subida en bytes y porcentaje (0-100). */
export interface UploadProgress {
  percent: number;
  loaded: number;
  total: number;
}

/** Respuesta 202 de POST /documents: identificador de seguimiento y estado inicial. */
export interface UploadedDocument {
  id: string;
  status: DocumentStatus;
}
