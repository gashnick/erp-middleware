import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Subscription } from '../../subscription/entities/subscription.entity';

@Entity({ schema: 'public', name: 'subscription_plans' })
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ unique: true })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'price_monthly', type: 'decimal', precision: 10, scale: 2 })
  priceMonthly: number;

  @Column({ name: 'price_yearly', type: 'decimal', precision: 10, scale: 2, nullable: true })
  priceYearly: number;

  @Column({ default: 'USD' })
  currency: string;

  @Column({ name: 'max_users' })
  maxUsers: number;

  @Column({ name: 'max_storage_gb' })
  maxStorageGb: number;

  @Column({ name: 'max_monthly_invoices' })
  maxMonthlyInvoices: number;

  @Column({ name: 'max_api_calls_monthly' })
  maxApiCallsMonthly: number;

  @Column({ name: 'ai_insights_enabled', default: false })
  aiInsightsEnabled: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'trial_days', default: 0 })
  trialDays: number;

  @OneToMany(() => Subscription, (subscription) => subscription.plan)
  subscriptions: Subscription[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
