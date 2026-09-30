import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document, DocumentStatus } from '../../documents/domain/document';
import { DocumentOrmEntity } from '../../documents/infrastructure/document.orm-entity';
import { DocumentProcessingRepository } from '../application/ports';

@Injectable()
export class TypeOrmDocumentProcessingRepository extends DocumentProcessingRepository {
  constructor(@InjectRepository(DocumentOrmEntity) private readonly orm: Repository<DocumentOrmEntity>) {
    super();
  }

  findById(id: string): Promise<Document | null> {
    return this.orm.findOneBy({ id });
  }

  /**
   * Un único `UPDATE` con estado y contenido; el `WHERE status = 'PROCESANDO'` evita pisar un
   * resultado ya guardado por otra entrega o instancia del Worker.
   */
  async saveOutcome(document: Document): Promise<boolean> {
    const result = await this.orm.update(
      { id: document.id, status: DocumentStatus.PROCESANDO },
      { status: document.status, content: document.content, updatedAt: () => 'now()' },
    );
    return (result.affected ?? 0) > 0;
  }
}
