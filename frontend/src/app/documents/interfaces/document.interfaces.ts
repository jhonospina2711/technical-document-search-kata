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

/** Respuesta 200 de GET /documents/:id; `content` es `null` mientras no esté `PROCESADO`. */
export interface DocumentDetail {
  id: string;
  title: string;
  author: string;
  category: string;
  tags: string[];
  version: string;
  fileName: string;
  fileFormat: DocumentFormat;
  status: DocumentStatus;
  content: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Respuesta 202 de POST /documents: identificador de seguimiento y estado inicial. */
export interface UploadedDocument {
  id: string;
  status: DocumentStatus;
}
