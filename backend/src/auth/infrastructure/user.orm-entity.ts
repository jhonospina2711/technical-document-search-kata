import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('users')
export class UserOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('text', { unique: true })
  email: string;

  @Column('text')
  name: string;

  @Column('text')
  password: string;

  @Column('boolean', { name: 'is_active', default: true })
  isActive: boolean;

  @Column('text', { array: true, default: () => `'{user}'` })
  roles: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
