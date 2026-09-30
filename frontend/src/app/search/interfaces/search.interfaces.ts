import { DocumentFormat } from '../../documents/interfaces/document.interfaces';

export type SearchSort = 'relevance' | 'date-desc' | 'date-asc' | 'title';

/** Tamaño de página fijo (SPEC-10 D-08); se envía como `pageSize` al contrato. */
export const SEARCH_PAGE_SIZE = 10;

/** Parámetros de la búsqueda tal como viven en la URL (`q`, `sort`, `page`). */
export interface SearchParams {
  q: string;
  sort: SearchSort;
  page: number;
}

/** Trozo del fragmento; `highlight` marca las coincidencias con el término buscado. */
export interface SnippetSegment {
  text: string;
  highlight: boolean;
}

export interface SearchSnippet {
  segments: SnippetSegment[];
  truncatedStart: boolean;
  truncatedEnd: boolean;
}

export interface SearchResultItem {
  id: string;
  title: string;
  author: string;
  format: DocumentFormat;
  version: string;
  tags: string[];
  createdAt: string;
  /** Relevancia normalizada de 0 a 1. */
  score: number;
  snippet: SearchSnippet;
}

/** Respuesta de `GET /search` (contrato propuesto, SPEC-10 §6). */
export interface SearchResponse {
  items: SearchResultItem[];
  total: number;
  page: number;
  pageSize: number;
  /** Tiempo de consulta medido por el servidor, en milisegundos. */
  tookMs: number;
  /** Documentos aún en `PROCESANDO` que todavía no pueden aparecer en resultados. */
  pendingCount: number;
}
