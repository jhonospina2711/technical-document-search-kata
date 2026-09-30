import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DocumentFormat } from '../../documents/domain/document';
import { DocumentSearchRepository, SearchCriteria, SearchHit, SearchPage, SearchSort } from '../domain/document-search.repository';
import { HIGHLIGHT_START, HIGHLIGHT_STOP, toSnippet } from './headline-segments';

/** Mismo tope que el índice (SPEC-13 FR-04): no tiene sentido resaltar lo que no se indexó. */
const HEADLINE_SOURCE_CHARS = 500_000;
const HEADLINE_OPTIONS =
  `StartSel=${HIGHLIGHT_START}, StopSel=${HIGHLIGHT_STOP}, MaxFragments=1, MaxWords=35, MinWords=15, ShortWord=3`;

/** Lista cerrada: el valor recibido nunca se concatena al SQL. `prefix` califica las columnas en consultas con joins. */
const ORDER_BY: Record<SearchSort, (prefix: string) => string> = {
  relevance: (p) => `${p}score DESC, ${p}created_at DESC, ${p}id ASC`,
  'date-desc': (p) => `${p}created_at DESC, ${p}id ASC`,
  'date-asc': (p) => `${p}created_at ASC, ${p}id ASC`,
  title: (p) => `${p}title ASC, ${p}id ASC`,
};

// `ts_rank` normalizado (32: rank / (rank + 1)) → [0, 1). `ts_headline` solo para las filas de la página;
// las marcas de control que ya tuviera el contenido se eliminan antes para que no falseen resaltados.
// `truncated_*` se calculan aquí para no transferir el contenido completo al API.
// `OFFSET 0` en los LATERAL `b` y `h` impide que el planificador los aplane: sin él copia `translate(left(...))`
// y `ts_headline(...)` en cada referencia (7 y 5 veces por fila) y un documento grande cuesta ~5 veces más.
const pageSql = (sort: SearchSort): string => String.raw`
  WITH q AS (SELECT websearch_to_tsquery('documents_es', $1) AS tsq),
  hits AS (
    SELECT d.id, d.title, d.created_at, ts_rank(d.search_vector, q.tsq, 32)::float8 AS score
    FROM documents d CROSS JOIN q
    WHERE d.status = 'PROCESADO' AND d.search_vector @@ q.tsq
  ),
  page AS (
    SELECT id, title, created_at, score FROM hits ORDER BY ${ORDER_BY[sort]('')} LIMIT $2 OFFSET $3
  )
  SELECT p.id, p.title, d.author, d.file_format, d.version, d.tags, p.created_at, p.score,
         h.headline,
         f.plain <> '' AND NOT starts_with(ltrim(b.body, E' \t\r\n'), f.plain) AS truncated_start,
         f.plain <> '' AND right(rtrim(b.body, E' \t\r\n'), length(f.plain)) <> f.plain AS truncated_end
  FROM page p
  JOIN documents d ON d.id = p.id
  CROSS JOIN q
  CROSS JOIN LATERAL (SELECT translate(left(d.content, ${HEADLINE_SOURCE_CHARS}), chr(1) || chr(2), '') AS body OFFSET 0) b
  CROSS JOIN LATERAL (SELECT ts_headline('documents_es', b.body, q.tsq, $4) AS headline OFFSET 0) h
  CROSS JOIN LATERAL (
    SELECT btrim(replace(replace(coalesce(h.headline, ''), chr(1), ''), chr(2), ''), E' \t\r\n') AS plain
  ) f
  ORDER BY ${ORDER_BY[sort]('p.')}`;

const COUNTS_SQL = `
  SELECT
    (SELECT count(*)::int FROM documents
      WHERE status = 'PROCESADO' AND search_vector @@ websearch_to_tsquery('documents_es', $1)) AS total,
    (SELECT count(*)::int FROM documents WHERE status = 'PROCESANDO') AS pending_count`;

interface PageRow {
  id: string;
  title: string;
  author: string;
  file_format: DocumentFormat;
  version: string;
  tags: string[];
  created_at: Date;
  score: number;
  headline: string | null;
  truncated_start: boolean | null;
  truncated_end: boolean | null;
}

interface CountsRow {
  total: number;
  pending_count: number;
}

@Injectable()
export class TypeOrmDocumentSearchRepository extends DocumentSearchRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super();
  }

  async search({ query, sort, page, pageSize }: SearchCriteria): Promise<SearchPage> {
    const [rows, [counts]] = await Promise.all([
      this.dataSource.query<PageRow[]>(pageSql(sort), [query, pageSize, (page - 1) * pageSize, HEADLINE_OPTIONS]),
      this.dataSource.query<CountsRow[]>(COUNTS_SQL, [query]),
    ]);
    return { hits: rows.map(toHit), total: counts.total, pendingCount: counts.pending_count };
  }
}

function toHit(row: PageRow): SearchHit {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    format: row.file_format,
    version: row.version,
    tags: row.tags ?? [],
    createdAt: row.created_at,
    score: Number(row.score.toFixed(4)),
    snippet: toSnippet(row.headline, row.truncated_start ?? false, row.truncated_end ?? false),
  };
}
