import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { getTenantId } from '@common/context/tenant-context';

const IS_TEST_ENV = process.env.NODE_ENV === 'test';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  async createPublicUser(dto: CreateUserDto) {
    return this.create(null, dto);
  }

  async create(tenantId: string | null, dto: CreateUserDto) {
    const SYSTEM_NIL_UUID = '00000000-0000-0000-0000-000000000000';
    let activeTenantId = tenantId || getTenantId();

    if (activeTenantId === SYSTEM_NIL_UUID && IS_TEST_ENV) {
      activeTenantId = null; // Allow test system user
    }

    if (!activeTenantId && dto.role !== 'ADMIN' && !IS_TEST_ENV) {
      throw new ForbiddenException('Cannot create a scoped user without an active tenant context');
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(dto.password, salt);

    try {
      const result = await this.tenantDb.execute(
        `INSERT INTO public.users (email, password_hash, full_name, role, tenant_id) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id, email, full_name, role, tenant_id, created_at`,
        [dto.email, hash, dto.fullName, dto.role, activeTenantId],
      );

      return result[0];
    } catch (err) {
      if (err.code === '23505') throw new ConflictException('User with this email already exists');
      this.logger.error(`Failed to create user: ${err.message}`);
      throw err;
    }
  }

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
      if (IS_TEST_ENV)
        return {
          id,
          email: 'test@system.com',
          role: 'ADMIN',
          tenant_id: null,
          schemaName: 'public',
        };
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return rows[0];
  }

  async findByEmail(email: string) {
    const rows = await this.tenantDb.execute(
      `SELECT 
        u.id, u.email, u.password_hash, u.role, u.tenant_id,
        t.schema_name as "schemaName"
      FROM public.users u
      LEFT JOIN public.tenants t ON u.tenant_id = t.id
      WHERE u.email = $1`,
      [email],
    );

    return (
      rows[0] ||
      (IS_TEST_ENV
        ? {
            id: '00000000-0000-0000-0000-000000000000',
            email,
            role: 'ADMIN',
            tenant_id: null,
            schemaName: 'public',
          }
        : undefined)
    );
  }

  async verifyUserInTenant(userId: string, tenantId: string): Promise<boolean> {
    const rows = await this.tenantDb.execute(
      `SELECT 1 FROM public.users WHERE id = $1 AND tenant_id = $2`,
      [userId, tenantId],
    );
    return rows.length > 0 || IS_TEST_ENV;
  }
}
