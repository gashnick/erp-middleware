import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { EncryptionService } from '@common/security/encryption.service';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { InjectRepository } from '@nestjs/typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import { Repository } from 'typeorm';
import { randomBytes, createHash } from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly tenantsService: TenantProvisioningService,
    private readonly encryptionService: EncryptionService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) return null;

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return null;

    const { password_hash, ...result } = user;
    return result;
  }

  async login(user: any) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: null,
      schemaName: 'public',
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshTokenPlain = randomBytes(64).toString('hex');
    const refreshTokenHash = this.hashToken(refreshTokenPlain);

    await this.refreshTokenRepo.save({
      user: { id: user.id } as any,
      tokenHash: refreshTokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    return {
      access_token: accessToken,
      refresh_token: refreshTokenPlain,
      user: { id: user.id, email: user.email, tenantId: null, role: user.role },
    };
  }

  async refresh(refreshToken: string) {
    const hash = this.hashToken(refreshToken);
    const stored = await this.refreshTokenRepo.findOne({
      where: { tokenHash: hash, isRevoked: false },
      relations: ['user'],
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Generate new access token (system login)
    const payload = {
      sub: stored.user.id,
      email: stored.user.email,
      role: stored.user.role,
      tenantId: null,
      schemaName: 'public',
    };

    const accessToken = this.jwtService.sign(payload);

    return { access_token: accessToken };
  }

  /**
   * TENANT MODE: Elevation
   * Generates tokens signed with the UNIQUE tenant secret.
   * Now returns BOTH access_token and refresh_token for consistency.
   */
  async generateTenantSession(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user || !user.tenant_id) throw new UnauthorizedException('User not linked to a tenant');

    const tenant = await this.tenantsService.findById(user.tenant_id);
    if (!tenant) throw new UnauthorizedException('Tenant not found');

    const masterKey = this.configService.get<string>('GLOBAL_MASTER_KEY')!;
    const decryptedSecret = this.encryptionService.decrypt(tenant.tenant_secret, masterKey);

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenant_id,
      schemaName: tenant.schema_name,
    };

    // Generate both access and refresh tokens signed with tenant secret
    const accessToken = this.jwtService.sign(payload, { secret: decryptedSecret });
    const refreshToken = this.jwtService.sign(payload, {
      secret: decryptedSecret,
      expiresIn: '7d',
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
