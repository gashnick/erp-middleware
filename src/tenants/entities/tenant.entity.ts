import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
} from 'typeorm';
import { Subscription } from '../../subscription/entities/subscription.entity';

@Entity({ schema: 'public', name: 'tenants' })
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  slug: string;

  @Column({ name: 'schema_name', unique: true })
  schemaName: string;

  @Column({ default: 'active' })
  status: string;

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId: string;

  @OneToOne(() => Subscription, (subscription) => subscription.tenant)
  subscription: Subscription;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
