import { DocumentFormat } from '../../../documents/domain/document';
import { SearchCriteria, Snippet } from '../../domain/document-search.repository';
import { SearchOutcome } from '../../application/search-documents.use-case';

export interface SearchResultItemResponse {
  id: string;
  title: string;
  author: string;
  format: DocumentFormat;
  version: string;
  tags: string[];
  createdAt: string;
  score: number;
  snippet: Snippet;
}

/** Contrato de `GET /search` (SPEC-10 §6): no expone `ownerId`, `content` completo ni `status`. */
export interface SearchResponse {
  items: SearchResultItemResponse[];
  total: number;
  page: number;
  pageSize: number;
  tookMs: number;
  pendingCount: number;
}

export function toSearchResponse(
  outcome: SearchOutcome,
  { page, pageSize }: Pick<SearchCriteria, 'page' | 'pageSize'>,
): SearchResponse {
  return {
    items: outcome.hits.map((hit) => ({
      id: hit.id,
      title: hit.title,
      author: hit.author,
      format: hit.format,
      version: hit.version,
      tags: hit.tags ?? [],
      createdAt: hit.createdAt.toISOString(),
      score: hit.score,
      snippet: hit.snippet,
    })),
    total: outcome.total,
    page,
    pageSize,
    tookMs: outcome.tookMs,
    pendingCount: outcome.pendingCount,
  };
}
