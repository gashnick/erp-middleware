import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/**
 * Tenant Entity
 *
 * Represents an organization/company using the platform.
 * Maps to the public.tenants table created by migrations.
 *
 * Each tenant gets:
 * - A record in this table (master schema)
 * - A dedicated schema (tenant_<uuid>) with all business tables
 *
 * Code Complete Principle: Entity mirrors database structure exactly
 */

@Entity('tenants', { schema: 'public' })
@Index('idx_tenants_status', ['status'], {
  where: 'deleted_at IS NULL',
})
@Index('idx_tenants_schema', ['schemaName'])
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 63, unique: true, name: 'schema_name' })
  schemaName: string;

  @Column({ type: 'varchar', length: 255, name: 'company_name' })
  companyName: string;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'data_source_type',
    enum: ['internal', 'external'],
  })
  dataSourceType: 'internal' | 'external';

  @Column({
    type: 'varchar',
    length: 50,
    name: 'subscription_plan',
    enum: ['basic', 'standard', 'enterprise'],
  })
  subscriptionPlan: 'basic' | 'standard' | 'enterprise';

  @Column({ type: 'jsonb', name: 'plan_limits' })
  planLimits: {
    max_users: number;
    max_storage_mb: number;
    max_connectors: number;
    max_api_calls_per_month: number;
    features: string[];
  };

  @Column({
    type: 'varchar',
    length: 20,
    enum: ['active', 'suspended', 'cancelled'],
    default: 'active',
  })
  status: 'active' | 'suspended' | 'cancelled';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt?: Date;
}
