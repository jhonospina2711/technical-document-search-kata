import { Logger } from '@nestjs/common';
import type { Request } from 'express';
import { DocumentFormat } from '../../documents/domain/document';
import { SearchDocuments, SearchOutcome } from '../application/search-documents.use-case';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchController } from './search.controller';

const outcome: SearchOutcome = {
  hits: [
    {
      id: 'doc-1',
      title: 'Guía',
      author: 'Ana',
      format: DocumentFormat.MD,
      version: '1.0.0',
      tags: [],
      createdAt: new Date('2026-09-30T10:00:00.000Z'),
      score: 0.5,
      snippet: { segments: [], truncatedStart: false, truncatedEnd: false },
    },
  ],
  total: 24,
  pendingCount: 1,
  tookMs: 12,
};

describe('SearchController', () => {
  const execute = jest.fn();
  const controller = new SearchController({ execute } as unknown as SearchDocuments);
  const req = { headers: { 'x-request-id': 'req-1' } } as unknown as Request;
  const query = { q: 'secreto-buscado', sort: 'title', page: 2, pageSize: 5 } as SearchQueryDto;

  beforeEach(() => {
    execute.mockReset().mockResolvedValue(outcome);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('delega en el caso de uso con los criterios validados (AC-01)', async () => {
    await controller.search(query, req);

    expect(execute).toHaveBeenCalledWith({ query: 'secreto-buscado', sort: 'title', page: 2, pageSize: 5 });
  });

  it('devuelve el contrato con page y pageSize de la petición', async () => {
    const response = await controller.search(query, req);

    expect(response).toMatchObject({ total: 24, page: 2, pageSize: 5, tookMs: 12, pendingCount: 1 });
    expect(response.items[0]).toMatchObject({ id: 'doc-1', createdAt: '2026-09-30T10:00:00.000Z', score: 0.5 });
  });

  it('registra el resultado con el requestId y sin el término buscado', async () => {
    const log = jest.spyOn(Logger.prototype, 'log');

    await controller.search(query, req);

    const message = String(log.mock.calls[0][0]);
    expect(message).toContain('req-1');
    expect(message).toContain('total 24');
    expect(message).not.toContain('secreto-buscado');
  });

  it('propaga los errores del caso de uso', async () => {
    execute.mockRejectedValue(new Error('db'));

    await expect(controller.search(query, req)).rejects.toThrow('db');
  });
});
