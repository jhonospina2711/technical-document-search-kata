import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document, NewDocument } from '../domain/document';
import { DocumentRepository } from '../domain/document.repository';
import { DocumentOrmEntity } from './document.orm-entity';

@Injectable()
export class TypeOrmDocumentRepository extends DocumentRepository {
  constructor(@InjectRepository(DocumentOrmEntity) private readonly orm: Repository<DocumentOrmEntity>) {
    super();
  }

  async add(document: NewDocument): Promise<Document> {
    return this.orm.save(this.orm.create(document));
  }

  async findById(id: string): Promise<Document | null> {
    return this.orm.findOneBy({ id });
  }

  async remove(id: string): Promise<void> {
    await this.orm.delete({ id });
  }
}
