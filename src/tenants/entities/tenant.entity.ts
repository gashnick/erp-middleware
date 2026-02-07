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
import { Subscription } from '../../subscription/entities/subscription.entity';
import { User } from '@users/entities/user.entity';

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

  // Improved Tenant Entity
  @ManyToOne(() => User) // Assuming you import User entity
  @JoinColumn({ name: 'owner_id' })
  @Index()
  owner: User;

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId: string;

  @OneToOne(() => Subscription, (subscription) => subscription.tenant)
  subscription: Subscription;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
