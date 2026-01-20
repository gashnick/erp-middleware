import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { getTenantId } from '@common/context/tenant-context';

@Injectable()
export class UsersService {
  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  /**
   * Creates a user WITHIN a tenant context (Member Invitation)
   * Principle: Encapsulation - The tenantId is pulled from context, not the DTO.
   */
  async create(dto: CreateUserDto) {
    const tenantId = getTenantId(); // Fail-fast: throws if context missing
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(dto.password, salt);

    const result = await this.tenantDb
      .execute(
        `INSERT INTO public.users (email, password_hash, role, tenant_id) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, email, role, tenant_id, created_at`,
        [dto.email, hash, dto.role, tenantId],
      )
      .catch((err) => {
        if (err.code === '23505') {
          throw new ConflictException('User with this email already exists in your organization');
        }
        throw err;
      });

    return result[0];
  }
  /**
   * Creates a "Public" user (Pre-organization setup)
   * tenant_id is explicitly null until createOrganization is called.
   */
  async createPublicUser(dto: CreateUserDto) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(dto.password, salt);

    // Note: tenant_id is omitted, defaulting to NULL in DB
    const result = await this.tenantDb
      .execute(
        `INSERT INTO public.users (email, password_hash, full_name, role, tenant_id) 
       VALUES ($1, $2, $3, $4, NULL) 
       RETURNING id, email, full_name, role, created_at`,
        [dto.email, hash, dto.fullName, dto.role],
      )
      .catch((err) => {
        if (err.code === '23505') {
          throw new ConflictException('Account with this email already exists');
        }
        throw err;
      });

    return result[0];
  }

  /**
   * Find user by ID (used during onboarding/token refresh)
   * Fail-fast: Throws NotFoundException if user doesn't exist
   */
  // src/users/users.service.ts

  async findById(id: string) {
    const rows = await this.tenantDb.execute(
      `SELECT 
        u.id, u.email, u.role, u.tenant_id,
        t.schema_name as "schemaName" 
     FROM public.users u
     LEFT JOIN public.tenants t ON u.tenant_id = t.id
     WHERE u.id = $1`,
      [id],
    );

    if (!rows || rows.length === 0) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return rows[0]; // This now contains .id, .email, .role, .tenant_id, and .schemaName
  }

  /**
   * Find user by Email (used during Login)
   */
  async findByEmail(email: string) {
    const rows = await this.tenantDb.execute(`SELECT * FROM public.users WHERE email = $1`, [
      email,
    ]);
    return rows[0]; // Returns undefined if not found, handled by AuthService
  }
}
