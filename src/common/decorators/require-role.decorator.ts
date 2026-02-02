// src/common/decorators/require-role.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@common/context/tenant-context';

/**
 * Decorator to require a specific user role for endpoint access.
 *
 * 🛡️ CRITICAL: Use RoleEnforcementGuard in conjunction with this decorator.
 *
 * @param role - Required user role (use specific SYSTEM_* roles for privilege minimization)
 *
 * @example
 * @Post('migrate')
 * @UseGuards(RoleEnforcementGuard)
 * @RequireRole(UserRole.SYSTEM_MIGRATION)
 * async runMigration() {
 *   // Only SYSTEM_MIGRATION role can access this
 * }
 *
 * @example
 * @Get('backup')
 * @UseGuards(RoleEnforcementGuard)
 * @RequireRole(UserRole.SYSTEM_READONLY)
 * async getBackup() {
 *   // Only SYSTEM_READONLY role can access this
 * }
 */
export const RequireRole = (role: UserRole | string) => SetMetadata('requiredRole', role);
