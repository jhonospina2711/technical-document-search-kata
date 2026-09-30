import { Controller, Get, Logger, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../auth/presentation/auth.guard';
import { requestIdOf } from '../../common/request-id';
import { SearchDocuments } from '../application/search-documents.use-case';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchResponse, toSearchResponse } from './dto/search.response';

@Controller('search')
@UseGuards(AuthGuard)
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(private readonly searchDocuments: SearchDocuments) {}

  @Get()
  async search(@Query() query: SearchQueryDto, @Req() req: Request): Promise<SearchResponse> {
    const { q, sort, page, pageSize } = query;
    const outcome = await this.searchDocuments.execute({ query: q, sort, page, pageSize });
    // No se registra el término buscado (puede ser sensible).
    this.logger.log(
      `[${requestIdOf(req)}] búsqueda: ${outcome.hits.length} resultados (total ${outcome.total}, página ${page}) en ${outcome.tookMs} ms`,
    );
    return toSearchResponse(outcome, { page, pageSize });
  }
}
