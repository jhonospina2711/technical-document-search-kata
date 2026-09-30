import { DocumentSearchRepository, SearchCriteria, SearchPage } from '../domain/document-search.repository';
import { SearchDocuments } from './search-documents.use-case';

const criteria: SearchCriteria = { query: 'kubernetes', sort: 'relevance', page: 1, pageSize: 10 };
const page: SearchPage = { hits: [], total: 0, pendingCount: 2 };

describe('SearchDocuments', () => {
  const search = jest.fn();
  const useCase = new SearchDocuments({ search } as unknown as DocumentSearchRepository);

  beforeEach(() => search.mockReset());
  afterEach(() => jest.restoreAllMocks());

  it('delega en el repositorio y devuelve la página tal cual (AC-01)', async () => {
    search.mockResolvedValue(page);

    const outcome = await useCase.execute(criteria);

    expect(search).toHaveBeenCalledWith(criteria);
    expect(outcome).toMatchObject(page);
  });

  it('mide tookMs en milisegundos enteros', async () => {
    search.mockResolvedValue(page);
    jest.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(142.6);

    const outcome = await useCase.execute(criteria);

    expect(outcome.tookMs).toBe(43);
  });

  it('propaga el error del repositorio', async () => {
    search.mockRejectedValue(new Error('db'));

    await expect(useCase.execute(criteria)).rejects.toThrow('db');
  });
});
