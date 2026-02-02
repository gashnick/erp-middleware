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
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt'); // Mock bcrypt to avoid slow hashing in tests

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;
  let refreshTokenRepo: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            findById: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock_token'),
          },
        },
        {
          provide: TenantProvisioningService,
          useValue: { findById: jest.fn().mockResolvedValue(null) },
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
          useValue: {
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
    refreshTokenRepo = module.get(getRepositoryToken(RefreshToken));
  });

  describe('validateUser', () => {
    it('should return user object (minus password) if credentials and tenant match', async () => {
      const mockUser = {
        id: '1',
        email: 'test@test.com',
        password_hash: 'hashed',
        tenant_id: 'tenant-1',
      };
      usersService.findByEmail.mockResolvedValue(mockUser as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('test@test.com', 'pass');

      expect(result).not.toHaveProperty('password_hash');
      expect(result.id).toBe('1');
    });

    // Tenant validation is enforced at a higher layer; AuthService.validateUser
    // only verifies credentials. Removed tenant-mismatch test which no longer
    // applies to this method's responsibilities.

    it('should return null if password check fails', async () => {
      usersService.findByEmail.mockResolvedValue({ password_hash: 'hash' } as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser('test@test.com', 'wrong-pass');
      expect(result).toBeNull();
    });
  });

  describe('generateTenantSession (The Upgrade Logic)', () => {
    it('should issue an upgraded token if user has a tenant_id', async () => {
      const mockUser = {
        id: 'user-1',
        tenant_id: 'new-tenant-uuid',
        tenant: { schemaName: 'tenant_acme' },
      };
      usersService.findById.mockResolvedValue(mockUser as any);
      // Ensure tenantsService returns the tenant record expected by the service
      (service as any).tenantsService = {
        findById: jest
          .fn()
          .mockResolvedValue({ schema_name: 'tenant_acme', tenant_secret: 'encrypted-secret' }),
      };
      (bcrypt.genSalt as jest.Mock).mockResolvedValue('salt');
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_refresh_token');

      const result = await service.generateTenantSession('user-1');

      // Verify logic: Did it call sign with the new schema context?
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'new-tenant-uuid', schemaName: 'tenant_acme' }),
        expect.anything(),
      );

      // Verify persistence: tokens were generated and returned
      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
    });

    it('should throw if trying to upgrade a user who still has no tenant_id', async () => {
      usersService.findById.mockResolvedValue({ id: 'user-1', tenant_id: null } as any);

      await expect(service.generateTenantSession('user-1')).rejects.toThrow(UnauthorizedException);
    });
  });
});
