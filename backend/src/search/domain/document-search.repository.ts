import { DocumentFormat } from '../../documents/domain/document';

export const SEARCH_SORTS = ['relevance', 'date-desc', 'date-asc', 'title'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export interface SearchCriteria {
  /** Texto en sintaxis de búsqueda web (términos, "frases", `or`, `-exclusión`); ya recortado. */
  query: string;
  sort: SearchSort;
  page: number;
  pageSize: number;
}

export interface SnippetSegment {
  text: string;
  highlight: boolean;
}

export interface Snippet {
  segments: SnippetSegment[];
  truncatedStart: boolean;
  truncatedEnd: boolean;
}

export interface SearchHit {
  id: string;
  title: string;
  author: string;
  format: DocumentFormat;
  version: string;
  tags: string[];
  createdAt: Date;
  /** Relevancia en [0, 1), independiente del resto de resultados. */
  score: number;
  snippet: Snippet;
}

export interface SearchPage {
  hits: SearchHit[];
  /** Documentos `PROCESADO` que coinciden, sin importar la página pedida. */
  total: number;
  /** Documentos aún en `PROCESANDO` (no buscables todavía). */
  pendingCount: number;
}

export abstract class DocumentSearchRepository {
  abstract search(criteria: SearchCriteria): Promise<SearchPage>;
}
