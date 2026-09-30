import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const HEADER = 'x-request-id';

/** Asigna un id propio a cada petición (ignora el del cliente) para correlacionar logs. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = randomUUID();
  req.headers[HEADER] = id;
  res.setHeader(HEADER, id);
  next();
}

export function requestIdOf(req: Request): string {
  return String(req.headers[HEADER] ?? '-');
}
