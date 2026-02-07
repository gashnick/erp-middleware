// src/auth/auth.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { EncryptionService } from '@common/security/encryption.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import { UnauthorizedException } from '@nestjs/common';
import * as bcryptjs from 'bcryptjs';

jest.mock('bcryptjs');

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;
  let tenantsService: jest.Mocked<TenantProvisioningService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: { findByEmail: jest.fn(), findById: jest.fn() },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('mock_token') },
        },
        {
          provide: TenantProvisioningService,
          useValue: { findById: jest.fn() },
        },
        {
          provide: EncryptionService,
          useValue: { decrypt: jest.fn().mockReturnValue('decrypted-secret') },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('GLOBAL_MASTER_KEY') },
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: { save: jest.fn(), findOne: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
    tenantsService = module.get(TenantProvisioningService);
  });

  describe('validateUser', () => {
    it('should return user minus password on success', async () => {
      const mockUser = { id: '1', email: 'a@b.com', password_hash: 'hash' };
      usersService.findByEmail.mockResolvedValue(mockUser as any);
      (bcryptjs.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('a@b.com', 'pass');

      expect(result).not.toHaveProperty('password_hash');
      expect(result?.id).toBe('1');
    });

    it('should return null on invalid password', async () => {
      usersService.findByEmail.mockResolvedValue({ password_hash: 'hash' } as any);
      (bcryptjs.compare as jest.Mock).mockResolvedValue(false);

      expect(await service.validateUser('a@b.com', 'wrong')).toBeNull();
    });
  });

  describe('generateTenantSession', () => {
    it('should issue tokens signed with tenant secret', async () => {
      const mockUser = { id: 'u1', tenant_id: 't1', email: 'a@b.com', role: 'ADMIN' };
      const mockTenant = { id: 't1', schema_name: 'tenant_acme', tenant_secret: 'enc-secret' };

      usersService.findById.mockResolvedValue(mockUser as any);
      tenantsService.findById.mockResolvedValue(mockTenant as any);

      const result = await service.generateTenantSession('u1');

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't1', schemaName: 'tenant_acme' }),
        expect.objectContaining({ secret: 'decrypted-secret' }),
      );
      expect(result.access_token).toBe('mock_token');
    });

    it('should throw if user has no tenant_id', async () => {
      usersService.findById.mockResolvedValue({ id: 'u1', tenant_id: null } as any);
      await expect(service.generateTenantSession('u1')).rejects.toThrow(UnauthorizedException);
    });
  });
});
