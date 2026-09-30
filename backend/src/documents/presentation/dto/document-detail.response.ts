import { Document, DocumentFormat, DocumentStatus } from '../../domain/document';

/** Detalle expuesto por `GET /documents/:id`; no incluye `ownerId`. */
export interface DocumentDetailResponse {
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

export function toDocumentDetail(document: Document): DocumentDetailResponse {
  return {
    id: document.id,
    title: document.title,
    author: document.author,
    category: document.category,
    tags: document.tags ?? [],
    version: document.version,
    fileName: document.fileName,
    fileFormat: document.fileFormat,
    status: document.status,
    content: document.content,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}
