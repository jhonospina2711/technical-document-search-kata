import { DocumentStatus } from './document';

export class InvalidDocumentTransitionError extends Error {
  constructor(from: DocumentStatus, to: DocumentStatus) {
    super(`Transición de estado no permitida: ${from} → ${to}`);
  }
}
