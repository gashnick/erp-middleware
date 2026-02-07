import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantsController, TenantsAliasController } from './tenants.controller';
import { Tenant } from './entities/tenant.entity';
import { DatabaseModule } from '@database/database.module';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { EncryptionModule } from '@common/security/encryption.module';
import { AuthModule } from '@auth/auth.module';

/**
 * Tenants Module
 *
 * Manages tenant lifecycle:
 * - Create/update/delete tenants
 * - Create/delete tenant schemas
 * - Query tenant information
 *
 * Code Complete Principle: Module organizes related functionality
 */

@Module({
  imports: [
    // Register Tenant entity with TypeORM
    TypeOrmModule.forFeature([Tenant]),
    DatabaseModule,
    EncryptionModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [TenantsController, TenantsAliasController],
  providers: [TenantProvisioningService],
  exports: [TenantProvisioningService], // Export for use in other modules (like Auth)
})
export class TenantsModule {}
