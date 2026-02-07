import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '@tenants/entities/tenant.entity';
import { SubscriptionPlan } from '../../subscription-plans/entities/subscription-plan.entity';

@Entity({ schema: 'public', name: 'subscriptions' })
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  @Index({ unique: true }) // Explicitly ensuring the index exists
  tenantId: string;

  @OneToOne(() => Tenant, (tenant) => tenant.subscription, {
    onDelete: 'CASCADE', // If Tenant is deleted, delete this subscription
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'plan_id' })
  @Index() // Crucial for reporting and analytics performance
  planId: string;

  @ManyToOne(() => SubscriptionPlan, (plan) => plan.subscriptions, {
    onDelete: 'RESTRICT', // Prevent deleting a Plan if tenants are still using it
  })
  @JoinColumn({ name: 'plan_id' })
  plan: SubscriptionPlan;

  @Column({
    type: 'varchar',
    length: 50,
    default: 'trial',
  })
  status: 'trial' | 'active' | 'past_due' | 'canceled' | 'unpaid';

  @Column({ name: 'current_period_start', type: 'timestamp' })
  currentPeriodStart: Date;

  @Column({ name: 'current_period_end', type: 'timestamp' })
  currentPeriodEnd: Date;

  @Column({ name: 'trial_ends_at', type: 'timestamp', nullable: true })
  trialEndsAt: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
