import { HttpErrorResponse } from '@angular/common/http';
import {
  SEARCH_PAGE_SIZE,
  SearchParams,
  SearchResponse,
  SearchResultItem,
  SearchSnippet,
  SnippetSegment,
} from '../interfaces/search.interfaces';

/**
 * Simulador del backend de búsqueda (SPEC-10 FR-09). NO es el mecanismo de búsqueda del producto,
 * que será PostgreSQL FTS: solo permite construir y probar la pantalla sin endpoint.
 * Se elimina cuando exista GET /search.
 */

export const MOCK_LATENCY_MS = 400;
/** Término reservado: fuerza un fallo 500 para ejercitar el estado de error. */
export const MOCK_ERROR_TERM = 'error';

const MOCK_TOOK_MS = 420;
const MOCK_PENDING_COUNT = 2;
const MIN_TOKEN_LENGTH = 3;
const SNIPPET_BEFORE = 80;
const SNIPPET_AFTER = 170;

interface MockDocument extends Omit<SearchResultItem, 'score' | 'snippet'> {
  content: string;
}

export const MOCK_DOCUMENTS: readonly MockDocument[] = [
  {
    id: '3f1b7a10-0001-4c1e-9a10-000000000001',
    title: 'Manual de Despliegue y Configuración de Clúster Kubernetes v1.28',
    author: 'Ing. Marcos Silva',
    format: 'PDF',
    version: '1.4.0',
    tags: ['k8s', 'produccion', 'helm'],
    createdAt: '2024-10-18T09:30:00.000Z',
    content:
      'Introducción al despliegue en entornos regulados. Para garantizar la alta disponibilidad en entornos bancarios, la configuración de kubernetes en topología multi-master requiere la parametrización de etcd distribuido con certificados TLS mutuos y políticas de red Calico estrictas. Se documenta además el procedimiento de actualización controlada.',
  },
  {
    id: '3f1b7a10-0002-4c1e-9a10-000000000002',
    title: 'Runbook de Emergencia: Rollback y Configuración de Kubernetes Ingress',
    author: 'DevOps Core Team',
    format: 'TXT',
    version: '2.1.3',
    tags: ['ingress', 'nginx'],
    createdAt: '2024-11-04T16:05:00.000Z',
    content:
      'Procedimiento de rollback ante incidentes. En caso de degradación de latencia superior al 5%, verificar la configuración de kubernetes en el ConfigMap de NGINX Ingress Controller ajustando los parámetros de keepalive_timeout y worker_connections de forma dinámica.',
  },
  {
    id: '3f1b7a10-0003-4c1e-9a10-000000000003',
    title: 'Estrategia de Seguridad y Configuración de Kubernetes RBAC Institucional',
    author: 'Dra. Carmen Soto',
    format: 'MD',
    version: '1.0.0',
    tags: ['seguridad', 'rbac'],
    createdAt: '2024-09-29T11:20:00.000Z',
    content:
      'El modelo de mínimo privilegio impone que toda configuración de kubernetes contenga ServiceAccounts acotados por Namespace, prohibiendo roles de tipo cluster-admin en aplicaciones de procesamiento regular.',
  },
  {
    id: '3f1b7a10-0004-4c1e-9a10-000000000004',
    title: 'Plantilla de Especificación de Recursos y Configuración de Kubernetes Kustomize',
    author: 'Arq. Alejandro Peña',
    format: 'PDF',
    version: '0.9.2',
    tags: ['kustomize', 'gitops'],
    createdAt: '2024-08-12T08:00:00.000Z',
    content:
      'Se estandariza la estructura de directorios overlays/base para la configuración de kubernetes, posibilitando derivar entornos staging y producción sin duplicidad de manifiestos yaml.',
  },
  {
    id: '3f1b7a10-0005-4c1e-9a10-000000000005',
    title: 'Guía de Observabilidad de Clústeres Kubernetes con Prometheus',
    author: 'Ing. Marcos Silva',
    format: 'MD',
    version: '1.2.0',
    tags: ['prometheus', 'k8s', 'observabilidad'],
    createdAt: '2024-07-22T14:45:00.000Z',
    content:
      'Las métricas de kubernetes se recolectan con ServiceMonitors. La configuración de alertas para nodos y pods debe versionarse junto al resto de manifiestos del clúster.',
  },
  {
    id: '3f1b7a10-0006-4c1e-9a10-000000000006',
    title: 'Política de Backups y Recuperación de etcd en Kubernetes',
    author: 'DevOps Core Team',
    format: 'TXT',
    version: '3.0.1',
    tags: ['etcd', 'backup'],
    createdAt: '2024-06-15T07:10:00.000Z',
    content:
      'Los snapshots de etcd se ejecutan cada hora y se conservan siete días. La restauración de un clúster de kubernetes exige detener el plano de control antes de aplicar el snapshot.',
  },
  {
    id: '3f1b7a10-0007-4c1e-9a10-000000000007',
    title: 'Estándar de Red: Calico y Políticas de Aislamiento en Kubernetes',
    author: 'Arq. Alejandro Peña',
    format: 'PDF',
    version: '1.1.0',
    tags: ['calico', 'red', 'seguridad'],
    createdAt: '2024-05-30T10:00:00.000Z',
    content:
      'Toda carga en kubernetes parte de una política de denegación por defecto. Las excepciones se declaran con NetworkPolicy y se revisan trimestralmente por el equipo de seguridad.',
  },
  {
    id: '3f1b7a10-0008-4c1e-9a10-000000000008',
    title: 'Procedimiento de Actualización de Versiones de Kubernetes',
    author: 'Ing. Marcos Silva',
    format: 'MD',
    version: '2.0.0',
    tags: ['upgrade', 'k8s'],
    createdAt: '2024-04-18T13:25:00.000Z',
    content:
      'La actualización de kubernetes se realiza nodo a nodo con drenado previo. Antes de cada salto de versión menor se valida la compatibilidad de las APIs obsoletas en los manifiestos.',
  },
  {
    id: '3f1b7a10-0009-4c1e-9a10-000000000009',
    title: 'Buenas Prácticas de Helm Charts para Kubernetes',
    author: 'Dra. Carmen Soto',
    format: 'PDF',
    version: '1.0.4',
    tags: ['helm', 'charts'],
    createdAt: '2024-03-09T09:00:00.000Z',
    content:
      'Cada chart declara requests y limits de recursos y valores por defecto seguros. La configuración de kubernetes específica de cada entorno se aísla en ficheros values por ambiente.',
  },
  {
    id: '3f1b7a10-0010-4c1e-9a10-000000000010',
    title: 'Runbook de Escalado Horizontal de Pods (HPA)',
    author: 'DevOps Core Team',
    format: 'TXT',
    version: '1.3.2',
    tags: ['hpa', 'escalado'],
    createdAt: '2024-02-20T18:40:00.000Z',
    content:
      'El HorizontalPodAutoscaler escala por CPU y por métricas personalizadas. En kubernetes, el umbral inicial recomendado es del 70% de utilización con un mínimo de dos réplicas.',
  },
  {
    id: '3f1b7a10-0011-4c1e-9a10-000000000011',
    title: 'Gestión de Secretos y Certificados en Kubernetes',
    author: 'Dra. Carmen Soto',
    format: 'MD',
    version: '1.5.0',
    tags: ['secretos', 'tls', 'seguridad'],
    createdAt: '2024-01-25T12:15:00.000Z',
    content:
      'Los secretos de kubernetes se cifran en reposo y se rotan cada noventa días. Los certificados TLS se emiten con cert-manager y se renuevan automáticamente treinta días antes de expirar.',
  },
  {
    id: '3f1b7a10-0012-4c1e-9a10-000000000012',
    title: 'Arquitectura de Referencia de Microservicios en Kubernetes',
    author: 'Arq. Alejandro Peña',
    format: 'PDF',
    version: '2.2.0',
    tags: ['microservicios', 'arquitectura'],
    createdAt: '2023-12-11T15:30:00.000Z',
    content:
      'Cada microservicio se despliega como un Deployment independiente dentro de kubernetes, con su propio esquema de base de datos y contratos versionados entre servicios.',
  },
  {
    id: '3f1b7a10-0013-4c1e-9a10-000000000013',
    title: 'Políticas de Terraform para Infraestructura en AWS',
    author: 'DevOps Core Team',
    format: 'MD',
    version: '1.0.0',
    tags: ['terraform', 'aws', 'iac'],
    createdAt: '2023-11-02T10:50:00.000Z',
    content:
      'Todo módulo de terraform debe pasar validación estática y revisión por pares. El estado remoto se guarda en S3 con bloqueo mediante DynamoDB y cifrado en reposo.',
  },
  {
    id: '3f1b7a10-0014-4c1e-9a10-000000000014',
    title: 'Convenciones de Logging Estructurado',
    author: 'Ing. Marcos Silva',
    format: 'TXT',
    version: '1.0.1',
    tags: ['logging', 'observabilidad'],
    createdAt: '2023-10-14T08:20:00.000Z',
    content:
      'Los servicios emiten logs en JSON con correlationId y nivel de severidad. Se prohíbe registrar datos personales o credenciales en cualquier nivel de log.',
  },
];

/** Minúsculas y sin acentos, conservando la longitud para poder mapear posiciones al texto original. */
function fold(text: string): string {
  return text
    .split('')
    .map((char) => char.normalize('NFD')[0].toLowerCase())
    .join('');
}

function tokenize(query: string): string[] {
  return fold(query)
    .split(/\s+/)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

function countOccurrences(haystack: string, token: string): number {
  let count = 0;
  for (let at = haystack.indexOf(token); at !== -1; at = haystack.indexOf(token, at + token.length)) {
    count++;
  }
  return count;
}

function buildSnippet(content: string, tokens: string[]): SearchSnippet {
  const folded = fold(content);
  const ranges: [number, number][] = [];
  for (const token of tokens) {
    for (let at = folded.indexOf(token); at !== -1; at = folded.indexOf(token, at + token.length)) {
      ranges.push([at, at + token.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }

  const first = merged[0]?.[0] ?? 0;
  let start = Math.max(0, first - SNIPPET_BEFORE);
  let end = Math.min(content.length, first + SNIPPET_AFTER);
  if (start > 0) {
    const space = content.indexOf(' ', start);
    start = space === -1 || space >= first ? start : space + 1;
  }
  if (end < content.length) {
    const space = content.lastIndexOf(' ', end);
    end = space <= first ? end : space;
  }

  const segments: SnippetSegment[] = [];
  let cursor = start;
  for (const [from, to] of merged) {
    if (to <= start || from >= end) {
      continue;
    }
    const markFrom = Math.max(from, start);
    const markTo = Math.min(to, end);
    if (markFrom > cursor) {
      segments.push({ text: content.slice(cursor, markFrom), highlight: false });
    }
    segments.push({ text: content.slice(markFrom, markTo), highlight: true });
    cursor = markTo;
  }
  if (cursor < end) {
    segments.push({ text: content.slice(cursor, end), highlight: false });
  }
  return { segments, truncatedStart: start > 0, truncatedEnd: end < content.length };
}

/** Responde como lo haría `GET /search`. Lanza un 500 simulado con el término reservado `error`. */
export function searchMock(params: SearchParams): SearchResponse {
  if (fold(params.q.trim()) === MOCK_ERROR_TERM) {
    throw new HttpErrorResponse({ status: 500, statusText: 'Mock error' });
  }

  const tokens = tokenize(params.q);
  const matches = tokens.length
    ? MOCK_DOCUMENTS.map((doc) => {
        const title = fold(doc.title);
        const content = fold(doc.content);
        if (!tokens.every((token) => title.includes(token) || content.includes(token))) {
          return null;
        }
        const raw = tokens.reduce(
          (sum, token) => sum + 3 * countOccurrences(title, token) + countOccurrences(content, token),
          0,
        );
        return { doc, raw };
      }).filter((match): match is { doc: MockDocument; raw: number } => match !== null)
    : [];

  const maxRaw = Math.max(1, ...matches.map((match) => match.raw));
  const scored = matches.map(({ doc, raw }) => {
    const { content, ...meta } = doc;
    // Puntuación simulada: el documento con más coincidencias obtiene 0,98.
    const score = Math.round((0.5 + 0.48 * (raw / maxRaw)) * 100) / 100;
    return { ...meta, score, snippet: buildSnippet(content, tokens) } satisfies SearchResultItem;
  });

  scored.sort((a, b) => {
    switch (params.sort) {
      case 'date-desc':
        return b.createdAt.localeCompare(a.createdAt);
      case 'date-asc':
        return a.createdAt.localeCompare(b.createdAt);
      case 'title':
        return a.title.localeCompare(b.title, 'es');
      default:
        return b.score - a.score || a.title.localeCompare(b.title, 'es');
    }
  });

  const from = (params.page - 1) * SEARCH_PAGE_SIZE;
  return {
    items: scored.slice(from, from + SEARCH_PAGE_SIZE),
    total: scored.length,
    page: params.page,
    pageSize: SEARCH_PAGE_SIZE,
    tookMs: MOCK_TOOK_MS,
    pendingCount: MOCK_PENDING_COUNT,
  };
}
