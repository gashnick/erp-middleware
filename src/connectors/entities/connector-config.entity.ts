import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('connector_configurations')
export class ConnectorConfiguration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  tenant_id: string;

  @Column({ type: 'varchar', length: 50 })
  type: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'jsonb' })
  credentials: Record<string, any>;

  @Column({ type: 'jsonb', default: {} })
  settings: Record<string, any>;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'timestamp', nullable: true })
  last_sync_at: Date;

  @Column({ type: 'varchar', length: 50, default: 'idle' })
  status: string;

  @Column({ type: 'text', nullable: true })
  last_error: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
