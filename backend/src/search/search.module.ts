import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SearchDocuments } from './application/search-documents.use-case';
import { DocumentSearchRepository } from './domain/document-search.repository';
import { TypeOrmDocumentSearchRepository } from './infrastructure/typeorm-document-search.repository';
import { SearchController } from './presentation/search.controller';

@Module({
  imports: [AuthModule],
  controllers: [SearchController],
  providers: [{ provide: DocumentSearchRepository, useClass: TypeOrmDocumentSearchRepository }, SearchDocuments],
})
export class SearchModule {}
