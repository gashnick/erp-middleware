import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { UserRole } from '../dto/create-user.dto'; // Import your Enum

@Entity('users')
// Adjusted index to handle nullable tenant_id for public users
@Index(['tenantId', 'email'], {
  unique: true,
  where: 'deleted_at IS NULL AND tenant_id IS NOT NULL',
})
@Index(['email'], { unique: true, where: 'deleted_at IS NULL AND tenant_id IS NULL' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Make relation nullable for the initial signup phase
  @ManyToOne(() => Tenant, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  // Explicitly allow null here
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null;

  @Column({ length: 255 })
  email: string;

  @Column({ name: 'password_hash', length: 255, nullable: true })
  passwordHash: string;

  @Column({ name: 'full_name', length: 255 })
  fullName: string;

  // OAuth fields
  @Column({ name: 'oauth_provider', length: 50, nullable: true })
  oauthProvider: string;

  @Column({ name: 'oauth_provider_id', length: 255, nullable: true })
  oauthProviderId: string;

  @Column({ name: 'profile_picture', length: 500, nullable: true })
  profilePicture: string;

  // Change to use the UserRole Enum for consistency with DTO/Swagger
  @Column({
    type: 'varchar',
    length: 50,
    default: UserRole.STAFF,
  })
  role: UserRole;

  @Column({ length: 20, default: 'active' })
  status: 'active' | 'inactive' | 'invited';

  @Column({ name: 'last_login_at', type: 'timestamp', nullable: true })
  lastLoginAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date;
}
