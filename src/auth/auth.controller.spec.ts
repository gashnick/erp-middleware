import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;
  let usersService: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            login: jest.fn(),
            validateUser: jest.fn(),
            generateTenantSession: jest.fn(),
            refresh: jest.fn(),
          },
        },
        {
          provide: UsersService,
          useValue: {
            createPublicUser: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
    usersService = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should call usersService.createPublicUser', async () => {
      const createUserDto = {
        email: 'test@test.com',
        password: 'password',
        fullName: 'Test User',
        role: 'ADMIN' as any,
      };
      jest
        .spyOn(usersService, 'createPublicUser')
        .mockResolvedValue({ id: '1', email: 'test@test.com' } as any);

      await controller.register(createUserDto);

      expect(usersService.createPublicUser).toHaveBeenCalledWith(createUserDto);
    });
  });

  describe('login', () => {
    it('should return public session for user without tenant', async () => {
      const loginDto = { email: 'test@test.com', password: 'password' };
      const mockUser = {
        id: '1',
        email: 'test@test.com',
        tenant_id: null,
        role: 'STAFF' as any,
      };

      jest.spyOn(authService, 'validateUser').mockResolvedValue(mockUser as any);
      jest.spyOn(authService, 'login').mockResolvedValue({
        access_token: 'token',
        refresh_token: 'refresh_token',
        user: {
          id: mockUser.id,
          email: mockUser.email,
          tenantId: null,
          role: mockUser.role,
        },
      });

      const result = await controller.login(loginDto);

      expect(authService.validateUser).toHaveBeenCalledWith(loginDto.email, loginDto.password);
      expect(authService.login).toHaveBeenCalled();
      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(result).toHaveProperty('user');
    });

    it('should return tenant session for user with tenant', async () => {
      const loginDto = { email: 'test@test.com', password: 'password' };
      const mockUser = {
        id: '1',
        email: 'test@test.com',
        tenant_id: 'tenant-1',
        role: 'ADMIN' as any,
      };

      jest.spyOn(authService, 'validateUser').mockResolvedValue(mockUser as any);
      jest.spyOn(authService, 'generateTenantSession').mockResolvedValue({
        access_token: 'token',
        refresh_token: 'refresh_token',
        user: {
          id: mockUser.id,
          email: mockUser.email,
          tenantId: mockUser.tenant_id,
          role: mockUser.role,
        },
      });

      const result = await controller.login(loginDto);

      expect(authService.validateUser).toHaveBeenCalledWith(loginDto.email, loginDto.password);
      expect(authService.generateTenantSession).toHaveBeenCalledWith('1');
      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(result).toHaveProperty('user');
    });
  });

  describe('refresh', () => {
    it('should throw UnauthorizedException when refreshToken is missing', async () => {
      await expect(controller.refresh('')).rejects.toThrow('Refresh token is required');
    });

    it('should call authService.refresh with the token', async () => {
      const refreshToken = 'refresh_token_value';
      jest.spyOn(authService, 'refresh').mockResolvedValue({
        access_token: 'new_token',
        refresh_token: 'new_refresh_token',
      });

      const result = await controller.refresh(refreshToken);

      expect(authService.refresh).toHaveBeenCalledWith(refreshToken);
      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
    });
  });

  describe('promote', () => {
    it('should call authService.generateTenantSession', async () => {
      const req = { user: { id: 'user-1' } } as any;
      jest.spyOn(authService, 'generateTenantSession').mockResolvedValue({
        access_token: 'tenant_token',
        refresh_token: 'tenant_refresh_token',
        user: {
          id: 'user-1',
          email: 'test@test.com',
          tenantId: 'tenant-1',
          role: 'ADMIN' as any,
        },
      });

      const result = await controller.promote(req);

      expect(authService.generateTenantSession).toHaveBeenCalledWith('user-1');
      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(result).toHaveProperty('user');
    });
  });
});
