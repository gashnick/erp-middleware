import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
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

      const result = await service.validateUser('test@test.com', 'pass', 'tenant-1');

      expect(result).not.toHaveProperty('password_hash');
      expect(result.id).toBe('1');
    });

    it('should throw UnauthorizedException if tenantIdHeader does not match user tenant_id', async () => {
      const mockUser = { id: '1', email: 'test@test.com', tenant_id: 'tenant-A' };
      usersService.findByEmail.mockResolvedValue(mockUser as any);

      await expect(service.validateUser('test@test.com', 'pass', 'tenant-B')).rejects.toThrow(
        UnauthorizedException,
      );
    });

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
      (bcrypt.genSalt as jest.Mock).mockResolvedValue('salt');
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_refresh_token');

      const result = await service.generateTenantSession('user-1');

      // Verify logic: Did it call sign with the new schema context?
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'new-tenant-uuid', schemaName: 'tenant_acme' }),
        expect.anything(),
      );

      // Verify persistence: Did it save to the refresh_tokens table?
      expect(refreshTokenRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', tokenHash: 'hashed_refresh_token' }),
      );

      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
    });

    it('should throw if trying to upgrade a user who still has no tenant_id', async () => {
      usersService.findById.mockResolvedValue({ id: 'user-1', tenant_id: null } as any);

      await expect(service.generateTenantSession('user-1')).rejects.toThrow(UnauthorizedException);
    });
  });
});
