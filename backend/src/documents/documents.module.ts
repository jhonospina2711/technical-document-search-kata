import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentOrmEntity } from './infrastructure/document.orm-entity';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentOrmEntity])],
})
export class DocumentsModule {}
