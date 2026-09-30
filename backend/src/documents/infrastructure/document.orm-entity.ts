import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { DocumentFormat, DocumentStatus } from '../domain/document';

@Entity('documents')
export class DocumentOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('text')
  title: string;

  @Column('text')
  author: string;

  @Column('text')
  category: string;

  @Column('text', { array: true, default: () => `'{}'` })
  tags: string[];

  @Column('text')
  version: string;

  @Column('text', { name: 'file_name' })
  fileName: string;

  @Column('text', { name: 'file_format' })
  fileFormat: DocumentFormat;

  @Index('IDX_documents_status')
  @Column('text', { default: DocumentStatus.PROCESANDO })
  status: DocumentStatus;

  @Column('text', { nullable: true })
  content: string | null;

  @Index('IDX_documents_owner_id')
  @Column('uuid', { name: 'owner_id' })
  ownerId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
