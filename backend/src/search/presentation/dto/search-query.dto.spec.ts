import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { SearchQueryDto } from './search-query.dto';

// Mismas opciones que `configureApp` (app.setup.ts).
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const metadata: ArgumentMetadata = { type: 'query', metatype: SearchQueryDto };
const parse = (query: Record<string, unknown>): Promise<SearchQueryDto> =>
  pipe.transform(query, metadata) as Promise<SearchQueryDto>;

describe('SearchQueryDto', () => {
  it('aplica valores por defecto: relevance, página 1, 10 por página (AC-01)', async () => {
    const dto = await parse({ q: 'kubernetes' });

    expect(dto).toMatchObject({ q: 'kubernetes', sort: 'relevance', page: 1, pageSize: 10 });
  });

  it('recorta q y convierte page y pageSize a número', async () => {
    const dto = await parse({ q: '  alta disponibilidad  ', sort: 'title', page: '3', pageSize: '25' });

    expect(dto).toMatchObject({ q: 'alta disponibilidad', sort: 'title', page: 3, pageSize: 25 });
  });

  it.each(['relevance', 'date-desc', 'date-asc', 'title'])('acepta sort=%s', async (sort) => {
    await expect(parse({ q: 'x', sort })).resolves.toMatchObject({ sort });
  });

  it('acepta q de exactamente 200 caracteres y los límites de page y pageSize', async () => {
    await expect(parse({ q: 'a'.repeat(200), page: '10000', pageSize: '50' })).resolves.toMatchObject({
      page: 10000,
      pageSize: 50,
    });
  });

  it.each<[string, Record<string, unknown>]>([
    ['q ausente', {}],
    ['q vacío', { q: '' }],
    ['q solo espacios', { q: '   ' }],
    ['q de 201 caracteres', { q: 'a'.repeat(201) }],
    ['q repetido (lista)', { q: ['a', 'b'] }],
    ['q con byte NUL', { q: 'abc\u0000def' }],
    ['sort desconocido', { q: 'x', sort: 'xyz' }],
    ['page 0', { q: 'x', page: '0' }],
    ['page no numérico', { q: 'x', page: 'abc' }],
    ['page decimal', { q: 'x', page: '1.5' }],
    ['page 10001', { q: 'x', page: '10001' }],
    ['pageSize 0', { q: 'x', pageSize: '0' }],
    ['pageSize 51', { q: 'x', pageSize: '51' }],
    ['parámetro desconocido', { q: 'x', filter: 'pdf' }],
  ])('rechaza con 400: %s (AC-10)', async (_name, query) => {
    await expect(parse(query)).rejects.toBeInstanceOf(BadRequestException);
  });
});
