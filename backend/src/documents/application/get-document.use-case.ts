import { Injectable } from '@nestjs/common';
import { Document } from '../domain/document';
import { DocumentRepository } from '../domain/document.repository';
import { DocumentNotFoundError } from '../domain/errors';

/** Devuelve el documento con su estado y contenido actuales; no lee el archivo original. */
@Injectable()
export class GetDocument {
  constructor(private readonly documents: DocumentRepository) {}

  async execute(id: string): Promise<Document> {
    const document = await this.documents.findById(id);
    if (!document) {
      throw new DocumentNotFoundError();
    }
    return document;
  }
}
