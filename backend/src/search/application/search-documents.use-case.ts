import { Injectable } from '@nestjs/common';
import { DocumentSearchRepository, SearchCriteria, SearchPage } from '../domain/document-search.repository';

export interface SearchOutcome extends SearchPage {
  /** Milisegundos de servidor que tardó la consulta. */
  tookMs: number;
}

/** Busca documentos `PROCESADO` por relevancia; no conoce SQL ni HTTP. */
@Injectable()
export class SearchDocuments {
  constructor(private readonly search: DocumentSearchRepository) {}

  async execute(criteria: SearchCriteria): Promise<SearchOutcome> {
    const startedAt = performance.now();
    const page = await this.search.search(criteria);
    return { ...page, tookMs: Math.round(performance.now() - startedAt) };
  }
}
